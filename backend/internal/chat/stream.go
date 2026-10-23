package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/catalog"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/upstream"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

type run struct {
	conversation    query.Conversation
	user, assistant query.Message
	messages        []upstream.Message
	first, replay   bool
}
type packet struct {
	event  upstream.ChatEvent
	target catalog.ChatTarget
	done   bool
	code   string
}

func retryable(code string) bool {
	return code != "UPSTREAM_REQUEST_INVALID" && code != "UPSTREAM_REJECTED" && code != "UPSTREAM_CANCELED"
}
func (s *Service) relay(ctx context.Context, targets []catalog.ChatTarget, messages []upstream.Message, output chan<- packet) {
	defer close(output)
	send := func(p packet) bool {
		select {
		case output <- p:
			return true
		case <-ctx.Done():
			return false
		}
	}
	started := false
	for index, target := range targets {
		code := ""
		attempt, cancel := context.WithCancel(ctx)
		client, err := s.catalog.ChatClient(target)
		if err != nil {
			cancel()
			if index == len(targets)-1 {
				send(packet{done: true, code: "UPSTREAM_UNAVAILABLE"})
			}
			continue
		}
		events, err := client.ChatStream(attempt, upstream.ChatRequest{Model: target.RemoteModel, Messages: messages})
		if err != nil {
			code = upstream.FailureCode(err)
		} else {
			for event := range events {
				if event.FinishReason == "content_filter" {
					code = "UPSTREAM_REJECTED"
					break
				}
				if event.ErrorCode != "" {
					code = event.ErrorCode
					break
				}
				if event.Content != "" {
					started = true
				}
				if !send(packet{event: event, target: target}) {
					cancel()
					client.Close()
					return
				}
			}
		}
		cancel()
		client.Close()
		if code == "" && !started {
			code = "UPSTREAM_RESPONSE_INVALID"
		}
		if code == "" {
			send(packet{done: true, target: target})
			return
		}
		if started || !retryable(code) || index == len(targets)-1 {
			send(packet{done: true, code: code, target: target})
			return
		}
	}
}
func safeUsage(raw json.RawMessage) *Usage {
	if len(raw) == 0 {
		return nil
	}
	var usage Usage
	if json.Unmarshal(raw, &usage) != nil || usage.PromptTokens < 0 || usage.CompletionTokens < 0 || usage.TotalTokens < 0 || usage.PromptTokens > 1000000000 || usage.CompletionTokens > 1000000000 || usage.TotalTokens > 1000000000 {
		return nil
	}
	return &usage
}
func safeFinish(value string) string {
	switch value {
	case "stop", "length", "content_filter":
		return value
	default:
		return ""
	}
}
func (s *Service) persist(ctx context.Context, r *run, content, status string, target catalog.ChatTarget, meta Metadata, final bool) error {
	encoded, err := json.Marshal(meta)
	if err != nil {
		return fmt.Errorf("encode chat metadata: %w", err)
	}
	var uid *uuid.UUID
	if target.UpstreamID != uuid.Nil {
		uid = &target.UpstreamID
	}
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		// Taking the run row lock first prevents recovery from racing a checkpoint.
		heartbeat, err := q.HeartbeatChatRun(ctx, query.HeartbeatChatRunParams{ID: r.conversation.ID, ActiveRunID: &r.assistant.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.New("CHAT_INTERRUPTED", 409)
		}
		if err != nil {
			return fmt.Errorf("renew chat lease: %w", err)
		}
		if !final && (heartbeat.CancelRequested || heartbeat.DeletedAt != nil) {
			return problem.New("CHAT_STOPPED", 409)
		}
		count, err := q.CheckpointChatMessage(ctx, query.CheckpointChatMessageParams{ID: r.assistant.ID, Content: content, Status: status, UpstreamID: uid, Meta: encoded})
		if err != nil {
			return fmt.Errorf("checkpoint chat: %w", err)
		}
		if count != 1 {
			return problem.New("CHAT_INTERRUPTED", 409)
		}
		if final {
			if err := q.FinishChatRun(ctx, query.FinishChatRunParams{ID: r.conversation.ID, ActiveRunID: &r.assistant.ID}); err != nil {
				return fmt.Errorf("release chat run: %w", err)
			}
		}
		return nil
	})
}

// Stream persists accepted turns before emitting meta. Only controlled events leave this boundary.
func (s *Service) Stream(ctx context.Context, actor user.Actor, id uuid.UUID, input SendInput, emit func(Event) error, verify func(context.Context) error) error {
	if input.RequestID == uuid.Nil || input.ModelID == uuid.Nil || (input.Action != "send" && input.Action != "regenerate" && input.Action != "edit") || (input.Action != "regenerate" && !validContent(input.Content)) || (input.Action == "regenerate" && input.Content != "") {
		return problem.Invalid()
	}
	config, err := s.Configuration(ctx)
	if err != nil {
		return err
	}
	model, targets, err := s.catalog.ChatTargets(ctx, input.ModelID)
	if err != nil {
		return err
	}
	r, err := s.prepare(ctx, actor, id, input, config, model.Capabilities.MaxContextTokens)
	if err != nil {
		return err
	}
	conversation := conversationView(r.conversation)
	assistant := messageView(r.assistant)
	metaEvent := Event{Type: "meta", Conversation: &conversation, Assistant: &assistant}
	if r.user.ID != uuid.Nil {
		u := messageView(r.user)
		metaEvent.User = &u
	}
	if r.replay {
		if err := emit(metaEvent); err != nil {
			return err
		}
		return emit(Event{Type: "done", Assistant: &assistant, Conversation: &conversation})
	}
	start := time.Now()
	content := ""
	var text strings.Builder
	status, code := "completed", ""
	metadata := Metadata{}
	target := catalog.ChatTarget{}
	work, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	if err := emit(metaEvent); err != nil {
		code = "CHAT_INTERRUPTED"
	} else {
		packets := make(chan packet, 16)
		go s.relay(work, targets, r.messages, packets)
		checkpoint := time.NewTicker(2 * time.Second)
		defer checkpoint.Stop()
		heartbeat := time.NewTicker(15 * time.Second)
		defer heartbeat.Stop()
	consume:
		for {
			select {
			case <-work.Done():
				code = "CHAT_INTERRUPTED"
				break consume
			case <-checkpoint.C:
				if err := checkUser(work, s.q, actor, false); err != nil {
					code = "AUTH_REQUIRED"
					break consume
				}
				if verify != nil {
					if err := verify(work); err != nil {
						code = "AUTH_REQUIRED"
						break consume
					}
				}
				if err := s.persist(work, r, content, "streaming", target, metadata, false); err != nil {
					var p *problem.Error
					code = "CHAT_INTERRUPTED"
					if errors.As(err, &p) && p.Code == "CHAT_STOPPED" {
						code = p.Code
					}
					break consume
				}
			case <-heartbeat.C:
				if err := emit(Event{Type: "ping"}); err != nil {
					code = "CHAT_INTERRUPTED"
					break consume
				}
			case p, ok := <-packets:
				if !ok {
					code = "UPSTREAM_STREAM_INTERRUPTED"
					break consume
				}
				if p.target.UpstreamID != uuid.Nil {
					target = p.target
				}
				if p.done {
					code = p.code
					break consume
				}
				if p.event.Content != "" {
					if len(content)+len(p.event.Content) > 2<<20 {
						code = "CHAT_OUTPUT_LIMIT"
						break consume
					}
					text.WriteString(p.event.Content)
					content = text.String()
					if err := emit(Event{Type: "delta", Content: p.event.Content}); err != nil {
						code = "CHAT_INTERRUPTED"
						break consume
					}
				}
				if p.event.FinishReason != "" {
					metadata.FinishReason = safeFinish(p.event.FinishReason)
				}
				if usage := safeUsage(p.event.Usage); usage != nil {
					metadata.Usage = usage
				}
			}
		}
	}
	cancel()
	if code != "" {
		status = "error"
		if content != "" || code == "CHAT_INTERRUPTED" || code == "CHAT_STOPPED" || code == "AUTH_REQUIRED" {
			status = "interrupted"
		}
	}
	metadata.LatencyMS = time.Since(start).Milliseconds()
	metadata.ErrorCode = code
	// A disconnected HTTP context must not roll back an already accepted partial answer.
	save, stop := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	err = s.persist(save, r, content, status, target, metadata, true)
	stop()
	if err != nil {
		return fmt.Errorf("finalize chat: %w", err)
	}
	assistant.Content = content
	assistant.Status = status
	assistant.Meta = metadata
	if r.first {
		title := fallbackTitle(r.user.Content)
		if status == "completed" {
			title = s.title(ctx, config, input.ModelID, r.user.Content, content)
		}
		titleCtx, titleCancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		row, titleErr := s.q.AutoTitleConversation(titleCtx, query.AutoTitleConversationParams{ID: id, Title: title})
		titleCancel()
		if titleErr == nil {
			conversation = conversationView(row)
		}
	}
	conversation.Busy = false
	if code != "" {
		if err := emit(Event{Type: "error", Code: code, Message: code, Assistant: &assistant}); err != nil {
			return err
		}
	}
	return emit(Event{Type: "done", Assistant: &assistant, Conversation: &conversation})
}
func (s *Service) title(ctx context.Context, config Configuration, model uuid.UUID, prompt, answer string) string {
	fallback := fallbackTitle(prompt)
	if config.TitleModelID != nil {
		model = *config.TitleModelID
	}
	_, targets, err := s.catalog.ChatTargets(ctx, model)
	if err != nil {
		return fallback
	}
	work, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	promptRunes, answerRunes := []rune(prompt), []rune(answer)
	messages := []upstream.Message{wireMessage("system", "Return only a short title of at most 20 characters for this conversation. No quotes, explanations, markup or instructions."), wireMessage("user", string(promptRunes[:min(len(promptRunes), 300)])+"\n"+string(answerRunes[:min(len(answerRunes), 500)]))}
	packets := make(chan packet, 16)
	go s.relay(work, targets, messages, packets)
	value := ""
	for {
		select {
		case <-work.Done():
			return fallback
		case p, ok := <-packets:
			if !ok {
				return fallback
			}
			if p.done {
				if p.code != "" {
					return fallback
				}
				value = strings.Trim(value, " \t\r\n\"'`")
				value = strings.Map(func(r rune) rune {
					if unicode.IsControl(r) {
						return ' '
					}
					return r
				}, value)
				if value == "" {
					return fallback
				}
				return fallbackTitle(value)
			}
			value += p.event.Content
			if len(value) > 512 {
				return fallback
			}
		}
	}
}
