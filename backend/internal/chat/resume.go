package chat

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	platformredis "github.com/xinghenWink/Lumi/backend/internal/platform/redis"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

func (s *Service) EnableResume(ctx context.Context, cache *platformredis.Client) func() {
	s.resume = cache
	s.lifetime = ctx
	return func() { s.workers.Wait() }
}
func (s *Service) CanResume() bool { return s.resume != nil && s.lifetime != nil }
func bufferKey(owner, id, request uuid.UUID) string {
	return owner.String() + ":" + id.String() + ":" + request.String()
}

// StartBuffered detaches transport failures from generation while retaining authorization checks.
func (s *Service) StartBuffered(ctx context.Context, actor user.Actor, id uuid.UUID, input SendInput, verify func(context.Context) error) error {
	if _, err := s.Conversation(ctx, actor.ID, id); err != nil {
		return err
	}
	if input.RequestID == uuid.Nil {
		return problem.Invalid()
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return fmt.Errorf("encode buffered request: %w", err)
	}
	digest := sha256.Sum256(raw)
	key := bufferKey(actor.ID, id, input.RequestID)
	reserved, err := s.resume.ReserveChat(ctx, key, hex.EncodeToString(digest[:]))
	if err != nil {
		var rejected *problem.Error
		if errors.As(err, &rejected) {
			return err
		}
		return problem.New("DEPENDENCY_UNAVAILABLE", 503)
	}
	if !reserved {
		return nil
	}
	first := make(chan error, 1)
	work, stopWork := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Minute)
	stopLifetime := context.AfterFunc(s.lifetime, stopWork)
	s.workers.Add(1)
	go func() {
		defer s.workers.Done()
		defer stopWork()
		defer stopLifetime()
		accepted := false
		emit := func(event Event) error {
			data, err := json.Marshal(event)
			if err != nil {
				return fmt.Errorf("encode buffered event: %w", err)
			}
			if err := s.resume.AppendChat(work, key, event.Type, string(data)); err != nil {
				return err
			}
			if !accepted {
				accepted = true
				first <- nil
			}
			return nil
		}
		err := s.Stream(work, actor, id, input, emit, verify)
		if !accepted {
			first <- err
		}
		if err != nil {
			code := "CHAT_INTERRUPTED"
			var rejected *problem.Error
			if errors.As(err, &rejected) {
				code = rejected.Code
			}
			save, cancel := context.WithTimeout(context.WithoutCancel(work), time.Second)
			defer cancel()
			data, encodeErr := json.Marshal(Event{Code: code, Message: code})
			if encodeErr != nil {
				return
			}
			if appendErr := s.resume.AppendChat(save, key, "error", string(data)); appendErr != nil {
				return
			}
			if appendErr := s.resume.AppendChat(save, key, "done", `{}`); appendErr != nil {
				return
			}
		}
	}()
	select {
	case err := <-first:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (s *Service) Buffered(ctx context.Context, owner, id, request uuid.UUID, after string, emit func(platformredis.ChatFrame) error, verify func(context.Context) error) error {
	if !s.CanResume() {
		return problem.New("CHAT_RESUME_EXPIRED", 410)
	}
	if request == uuid.Nil || len(after) > 40 || (after != "" && !regexp.MustCompile(`^\d+-\d+$`).MatchString(after)) {
		return problem.Invalid()
	}
	if _, err := s.Conversation(ctx, owner, id); err != nil {
		return err
	}
	checked := time.Time{}
	idle := time.Now()
	for {
		if time.Since(checked) > 2*time.Second {
			if verify != nil {
				if err := verify(ctx); err != nil {
					return err
				}
			}
			if _, err := s.Conversation(ctx, owner, id); err != nil {
				return err
			}
			checked = time.Now()
		}
		rows, err := s.resume.ReadChat(ctx, bufferKey(owner, id, request), after)
		if err != nil {
			return err
		}
		for _, row := range rows {
			if err := emit(row); err != nil {
				return err
			}
			after = row.ID
			idle = time.Now()
			if row.Type == "done" {
				return nil
			}
		}
		if time.Since(idle) > 20*time.Second {
			return problem.New("CHAT_RESUME_EXPIRED", 410)
		}
		if err:=ctx.Err();err!=nil{return err}
	}
}
