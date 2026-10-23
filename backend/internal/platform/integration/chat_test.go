//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/catalog"
	"github.com/xinghenWink/Lumi/backend/internal/chat"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

func TestChatPersistenceIsolationRetryStopAndLimits(t *testing.T) {
	f := newAccountFixture(t)
	actor := creditActor(t, f)
	service := f.services.Chat
	var good, bad atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Model    string                           `json:"model"`
			Messages []struct{ Role, Content string } `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			http.Error(w, "invalid", 400)
			return
		}
		if input.Model == "bad" {
			bad.Add(1)
			w.WriteHeader(429)
			return
		}
		good.Add(1)
		if len(input.Messages) == 0 {
			w.WriteHeader(400)
			return
		}
		prompt := input.Messages[len(input.Messages)-1].Content
		value := "Hello"
		if strings.HasPrefix(input.Messages[0].Content, "Return only") {
			value = "真实聊天"
		}
		w.Header().Set("Content-Type", "text/event-stream")
		if prompt == "empty" {
			if _, err := fmt.Fprint(w, "data: [DONE]\n\n"); err != nil {
				return
			}
			return
		}
		if _, err := fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":%q}}]}\n\n", value); err != nil {
			return
		}
		if flush, ok := w.(http.Flusher); ok {
			flush.Flush()
		}
		if prompt == "slow" {
			<-r.Context().Done()
			return
		}
		if prompt == "interrupt" {
			return
		}
		if _, err := fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":2,\"total_tokens\":12}}\n\ndata: [DONE]\n\n"); err != nil {
			return
		}
	}))
	defer server.Close()
	key := "fixture-chat-only"
	channel, err := f.services.Catalog.SaveChannel(f.ctx, actor, uuid.Nil, catalog.ChannelInput{Name: "Chat fixture", BaseURL: server.URL + "/v1", APIKey: &key, TimeoutChatS: 10, TimeoutImageS: 10, Weight: 1, Enabled: true, EditFormat: "multipart"})
	if err != nil {
		t.Fatal(err)
	}
	model, err := f.services.Catalog.SaveModel(f.ctx, actor, uuid.Nil, catalog.ModelInput{DisplayName: "平台对话", Type: "chat", Enabled: true, Capabilities: catalog.Capabilities{Stream: true, MaxContextTokens: 32768}, Routes: []catalog.RouteInput{{UpstreamID: channel.ID, UpstreamModelName: "bad", Priority: 0, Weight: 1, Enabled: true}, {UpstreamID: channel.ID, UpstreamModelName: "good", Priority: 1, Weight: 1, Enabled: true}}})
	if err != nil {
		t.Fatal(err)
	}
	config, err := service.Configuration(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	config.PerMinute = 0
	if _, err := service.SaveConfiguration(f.ctx, actor, config); err != nil {
		t.Fatal(err)
	}
	id := uuid.New()
	if _, err := service.Create(f.ctx, actor.ID, id, model.ID); err != nil {
		t.Fatal(err)
	}
	input := chat.SendInput{RequestID: uuid.New(), ModelID: model.ID, Action: "send", Content: "first"}
	var events []chat.Event
	emit := func(e chat.Event) error { events = append(events, e); return nil }
	if err := service.Stream(f.ctx, actor, id, input, emit, nil); err != nil {
		t.Fatal(err)
	}
	if len(events) < 3 || events[0].Type != "meta" || events[len(events)-1].Type != "done" {
		t.Fatal("missing stream lifecycle")
	}
	messages, err := service.Messages(f.ctx, actor.ID, id, "", 100)
	if err != nil || len(messages.Items) != 2 || messages.Items[0].Content != "Hello" || messages.Items[0].Status != "completed" || messages.Items[0].Meta.Usage.TotalTokens != 12 {
		t.Fatalf("messages=%+v error=%v", messages, err)
	}
	before := good.Load()
	if err := service.Stream(f.ctx, actor, id, input, func(chat.Event) error { return nil }, nil); err != nil {
		t.Fatal(err)
	}
	if good.Load() != before {
		t.Fatal("request replay called provider")
	}
	conflict := input
	conflict.Content = "different"
	if err := service.Stream(f.ctx, actor, id, conflict, emit, nil); creditCode(err) != "CHAT_REQUEST_CONFLICT" {
		t.Fatalf("request conflict=%v", err)
	}
	member := creditMember(t, f, actor, 0)
	if _, err := service.Messages(f.ctx, member.ID, id, "", 100); creditCode(err) != "CHAT_NOT_FOUND" {
		t.Fatal("cross-user messages exposed")
	}
	client := f.client(t)
	login := f.login(t, client, member.Email, "Integration-password-1")
	expectStatus(t, f.call(t, client, "GET", "/api/v1/conversations/"+id.String()+"/messages", login.AccessToken, nil), 404)
	expectStatus(t, f.call(t, client, "GET", "/api/v1/admin/chat-settings", login.AccessToken, nil), 403)
	encoded, err := json.Marshal(messages)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{key, server.URL, "upstream_id", "request_hash", "wire_model"} {
		if strings.Contains(string(encoded), secret) {
			t.Fatal("private routing material exposed")
		}
	}
	lastUser := messages.Items[1].ID
	regenerate := chat.SendInput{RequestID: uuid.New(), ModelID: model.ID, Action: "regenerate", LastMessageID: &lastUser}
	if err := service.Stream(f.ctx, actor, id, regenerate, emit, nil); err != nil {
		t.Fatal(err)
	}
	messages, err = service.Messages(f.ctx, actor.ID, id, "", 100)
	if err != nil || len(messages.Items) != 2 {
		t.Fatal("regenerate duplicated user turn")
	}
	edited := chat.SendInput{RequestID: uuid.New(), ModelID: model.ID, Action: "edit", Content: "interrupt", LastMessageID: &lastUser}
	badBefore := bad.Load()
	if err := service.Stream(f.ctx, actor, id, edited, emit, nil); err != nil {
		t.Fatal(err)
	}
	messages, err = service.Messages(f.ctx, actor.ID, id, "", 100)
	if err != nil || messages.Items[0].Status != "interrupted" || messages.Items[0].Content != "Hello" || bad.Load() != badBefore+1 {
		t.Fatal("interrupted answer lost or replayed")
	}
	if _, err := service.Create(f.ctx, actor.ID, uuid.New(), model.ID); err != nil {
		t.Fatal(err)
	}
	slowID := uuid.New()
	if _, err := service.Create(f.ctx, actor.ID, slowID, model.ID); err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	var once sync.Once
	done := make(chan error, 1)
	go func() {
		done <- service.Stream(f.ctx, actor, slowID, chat.SendInput{RequestID: uuid.New(), ModelID: model.ID, Action: "send", Content: "slow"}, func(e chat.Event) error {
			if e.Type == "delta" {
				once.Do(func() { close(started) })
			}
			return nil
		}, nil)
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("slow stream never started")
	}
	busy := service.Stream(f.ctx, actor, slowID, chat.SendInput{RequestID: uuid.New(), ModelID: model.ID, Action: "send", Content: "overlap"}, emit, nil)
	if creditCode(busy) != "CHAT_BUSY" {
		t.Fatalf("concurrent claim=%v", busy)
	}
	if err := service.Stop(f.ctx, actor.ID, slowID); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("stop did not cancel upstream")
	}
	recovered, err := service.Messages(f.ctx, actor.ID, slowID, "", 100)
	if err != nil || recovered.Items[0].Content != "Hello" || recovered.Items[0].Meta.ErrorCode != "CHAT_STOPPED" {
		t.Fatal("stopped partial answer not retained")
	}
	emptyID := uuid.New()
	if _, err := service.Create(f.ctx, actor.ID, emptyID, model.ID); err != nil {
		t.Fatal(err)
	}
	if err := service.Stream(f.ctx, actor, emptyID, chat.SendInput{RequestID: uuid.New(), ModelID: model.ID, Action: "send", Content: "empty"}, emit, nil); err != nil {
		t.Fatal(err)
	}
	emptyMessages, err := service.Messages(f.ctx, actor.ID, emptyID, "", 100)
	if err != nil || emptyMessages.Items[0].Status != "error" || emptyMessages.Items[0].Meta.ErrorCode != "UPSTREAM_RESPONSE_INVALID" {
		t.Fatal("empty upstream answer accepted")
	}
	config, err = service.Configuration(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	config.PerMinute = 1
	config, err = service.SaveConfiguration(f.ctx, actor, config)
	if err != nil {
		t.Fatal(err)
	}
	memberRecord, err := query.New(f.pool).GetUserByEmail(f.ctx, member.Email)
	if err != nil {
		t.Fatal(err)
	}
	memberActor := user.Actor{ID: member.ID, TokenVersion: memberRecord.TokenVersion, IP: actor.IP}
	limitedID := uuid.New()
	if _, err := service.Create(f.ctx, member.ID, limitedID, model.ID); err != nil {
		t.Fatal(err)
	}
	limited := chat.SendInput{RequestID: uuid.New(), ModelID: model.ID, Action: "send", Content: "minute"}
	discard := func(chat.Event) error { return nil }
	if err := service.Stream(f.ctx, memberActor, limitedID, limited, discard, nil); err != nil {
		t.Fatal(err)
	}
	before = good.Load()
	if err := service.Stream(f.ctx, memberActor, limitedID, limited, discard, nil); err != nil || good.Load() != before {
		t.Fatalf("limited replay called provider or consumed quota: %v", err)
	}
	limited.RequestID = uuid.New()
	if err := service.Stream(f.ctx, memberActor, limitedID, limited, discard, nil); creditCode(err) != "CHAT_RATE_LIMITED" || good.Load() != before {
		t.Fatalf("minute limit did not reject before provider call: %v", err)
	}
	var dailyCount int
	if err := f.pool.QueryRow(f.ctx, "SELECT count FROM chat_daily_usage WHERE user_id=$1 AND day=(now() AT TIME ZONE 'UTC')::date", member.ID).Scan(&dailyCount); err != nil || dailyCount != 1 {
		t.Fatalf("rejected or replayed request changed daily count: count=%d error=%v", dailyCount, err)
	}
	config.PerMinute = 0
	config.PerDay = 1
	if _, err := service.SaveConfiguration(f.ctx, actor, config); err != nil {
		t.Fatal(err)
	}
	if err := service.Stream(f.ctx, actor, id, chat.SendInput{RequestID: uuid.New(), ModelID: model.ID, Action: "send", Content: "quota"}, emit, nil); creditCode(err) != "CHAT_DAILY_LIMIT" {
		t.Fatalf("daily limit=%v", err)
	}
	// Recovery must not interrupt another healthy process's active lease.
	q := query.New(f.pool)
	recoveryID := uuid.New()
	if _, err := service.Create(f.ctx, actor.ID, recoveryID, model.ID); err != nil {
		t.Fatal(err)
	}
	aid := uuid.New()
	if _, err := q.InsertChatMessage(f.ctx, query.InsertChatMessageParams{ID: aid, ConversationID: recoveryID, RequestID: uuid.New(), Role: "assistant", Content: "checkpoint", Status: "streaming", ModelID: &model.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := q.StartChatRun(f.ctx, query.StartChatRunParams{ID: recoveryID, UserID: actor.ID, ActiveRunID: &aid, ModelID: &model.ID}); err != nil {
		t.Fatal(err)
	}
	if err := service.Recover(f.ctx); err != nil {
		t.Fatal(err)
	}
	current, err := service.Conversation(f.ctx, actor.ID, recoveryID)
	if err != nil || !current.Busy {
		t.Fatal("healthy lease recovered")
	}
	if _, err := f.pool.Exec(f.ctx, "UPDATE conversations SET lease_until=now()-interval '1 minute' WHERE id=$1", recoveryID); err != nil {
		t.Fatal(err)
	}
	if err := service.Recover(f.ctx); err != nil {
		t.Fatal(err)
	}
	recovered, err = service.Messages(f.ctx, actor.ID, recoveryID, "", 100)
	if err != nil || recovered.Items[0].Status != "interrupted" || recovered.Items[0].Content != "checkpoint" {
		t.Fatal("expired lease not recovered")
	}
	ctx, cancel := context.WithCancel(f.ctx)
	cancel()
	if err := service.Stream(ctx, user.Actor{ID: actor.ID}, id, input, emit, nil); err == nil {
		t.Fatal("canceled context ignored")
	}
}
