//go:build integration

package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/catalog"
	"github.com/xinghenWink/Lumi/backend/internal/chat"
	platformredis "github.com/xinghenWink/Lumi/backend/internal/platform/redis"
	"github.com/xinghenWink/Lumi/backend/internal/upstream"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

func TestM6BufferedChatResumesWithoutSecondProviderCallAndSupportsVision(t *testing.T) {
	f := newAccountFixture(t)
	actor := creditActor(t, f)
	s := f.services.Chat
	lifetime, cancel := context.WithCancel(f.ctx)
	wait := s.EnableResume(lifetime, f.cache)
	t.Cleanup(func() { cancel(); wait() })
	release := make(chan struct{})
	started := make(chan struct{}, 1)
	var calls atomic.Int32
	var sawVision, sawInstructions atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages []struct {
				Role    string          `json:"role"`
				Content json.RawMessage `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Messages) == 0 {
			w.WriteHeader(400)
			return
		}
		if strings.Contains(string(body.Messages[0].Content), "Return only") {
			w.Header().Set("Content-Type", "text/event-stream")
			if _, err := fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"Title\"}}]}\n\ndata: [DONE]\n\n"); err != nil {
				return
			}
			return
		}
		calls.Add(1)
		sawInstructions.Store(strings.Contains(string(body.Messages[0].Content), "Answer briefly"))
		sawVision.Store(strings.Contains(string(body.Messages[len(body.Messages)-1].Content), "data:image/png;base64,"))
		w.Header().Set("Content-Type", "text/event-stream")
		if _, err := fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"Hello \"}}]}\n\n"); err != nil {
			return
		}
		if flush, ok := w.(http.Flusher); ok {
			flush.Flush()
		}
		started <- struct{}{}
		select {
		case <-r.Context().Done():
			return
		case <-release:
		}
		if _, err := fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"World\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"); err != nil {
			return
		}
	}))
	defer server.Close()
	key := "m6-upstream-fixture"
	channel, err := f.services.Catalog.SaveChannel(f.ctx, actor, uuid.Nil, catalog.ChannelInput{Name: "M6", BaseURL: server.URL + "/v1", APIKey: &key, TimeoutChatS: 20, TimeoutImageS: 20, Weight: 1, Enabled: true, EditFormat: "multipart"})
	if err != nil {
		t.Fatal(err)
	}
	model, err := f.services.Catalog.SaveModel(f.ctx, actor, uuid.Nil, catalog.ModelInput{DisplayName: "Vision", Type: "chat", Enabled: true, Capabilities: catalog.Capabilities{Stream: true, Vision: true, MaxContextTokens: 32000}, Routes: []catalog.RouteInput{{UpstreamID: channel.ID, UpstreamModelName: "vision-fixture", Weight: 1, Enabled: true}}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.services.Users.SavePreferences(f.ctx, actor, user.Preferences{Theme: "system", Instructions: "Answer briefly", ImageQuality: "medium", ImageRatio: "1:1", ImageCount: 1})
	if err != nil {
		t.Fatal(err)
	}
	var bitmap bytes.Buffer
	if err := png.Encode(&bitmap, image.NewNRGBA(image.Rect(0, 0, 8, 8))); err != nil {
		t.Fatal(err)
	}
	file, err := f.services.Files.Upload(f.ctx, actor, "upload", bitmap.Bytes(), 10<<20)
	if err != nil {
		t.Fatal(err)
	}
	id := uuid.New()
	if _, err := s.Create(f.ctx, actor.ID, id, model.ID); err != nil {
		t.Fatal(err)
	}
	input := chat.SendInput{RequestID: uuid.New(), ModelID: model.ID, Action: "send", Content: "Describe this image", ReferenceFileIDs: []uuid.UUID{file.ID}}
	request, cancelRequest := context.WithCancel(f.ctx)
	if err := s.StartBuffered(request, actor, id, input, nil); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("provider did not start")
	}
	last := ""
	partial, cancelPartial := context.WithCancel(f.ctx)
	if err := s.Buffered(partial, actor.ID, id, input.RequestID, "", func(frame platformredis.ChatFrame) error {
		last = frame.ID
		if frame.Type == "delta" {
			cancelPartial()
		}
		return nil
	}, nil); err != nil && !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	cancelRequest()
	cancelPartial()
	close(release)
	var content strings.Builder
	done := false
	if err := s.Buffered(f.ctx, actor.ID, id, input.RequestID, last, func(frame platformredis.ChatFrame) error {
		if frame.Type == "delta" {
			var e chat.Event
			if err := json.Unmarshal([]byte(frame.Data), &e); err != nil {
				return err
			}
			content.WriteString(e.Content)
		}
		if frame.Type == "done" {
			done = true
		}
		return nil
	}, nil); err != nil {
		t.Fatal(err)
	}
	if content.String() != "World" || !done || !sawVision.Load() || !sawInstructions.Load() {
		t.Fatalf("resume text=%q done=%v vision=%v instructions=%v", content.String(), done, sawVision.Load(), sawInstructions.Load())
	}
	if err := s.StartBuffered(f.ctx, actor, id, input, nil); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatal("reconnect called upstream twice")
	}
	input.Content = "Changed"
	if err := s.StartBuffered(f.ctx, actor, id, input, nil); creditCode(err) != "CHAT_REQUEST_CONFLICT" {
		t.Fatalf("changed buffered replay=%v", err)
	}
	if err := s.Buffered(f.ctx, uuid.New(), id, input.RequestID, "", func(platformredis.ChatFrame) error { return nil }, nil); creditCode(err) != "CHAT_NOT_FOUND" {
		t.Fatalf("another user read stream: %v", err)
	}
	exports, err := s.Export(f.ctx, actor.ID, &id)
	if err != nil || len(exports) != 1 || !strings.Contains(chat.MarkdownExport(exports), "Hello World") {
		t.Fatalf("export incomplete: %v", err)
	}
}

func TestM6CircuitSkipsOpenRoutesAndAllowsOneHalfOpenProbe(t *testing.T) {
	f := newAccountFixture(t)
	actor := creditActor(t, f)
	var failing atomic.Bool
	failing.Store(true)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if failing.Load() {
			w.WriteHeader(503)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		if _, err := fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"OK\"}}]}\n\ndata: [DONE]\n\n"); err != nil {
			return
		}
	}))
	defer server.Close()
	key := "circuit-fixture"
	channel, err := f.services.Catalog.SaveChannel(f.ctx, actor, uuid.Nil, catalog.ChannelInput{Name: "Circuit", BaseURL: server.URL + "/v1", APIKey: &key, TimeoutChatS: 10, TimeoutImageS: 10, Weight: 1, Enabled: true, EditFormat: "multipart"})
	if err != nil {
		t.Fatal(err)
	}
	model, err := f.services.Catalog.SaveModel(f.ctx, actor, uuid.Nil, catalog.ModelInput{DisplayName: "Circuit model", Type: "chat", Enabled: true, Capabilities: catalog.Capabilities{Stream: true, MaxContextTokens: 32000}, Routes: []catalog.RouteInput{{UpstreamID: channel.ID, UpstreamModelName: "circuit", Weight: 1, Enabled: true}}})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		if _, err := f.services.Catalog.Test(f.ctx, actor, channel.ID); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := f.services.Catalog.ChatTargets(f.ctx, model.ID); creditCode(err) != "CHAT_MODEL_UNAVAILABLE" {
		t.Fatalf("open channel was routed: %v", err)
	}
	if _, err := f.pool.Exec(f.ctx, "UPDATE upstreams SET open_until=now()-interval '1 second' WHERE id=$1", channel.ID); err != nil {
		t.Fatal(err)
	}
	_, targets, err := f.services.Catalog.ChatTargets(f.ctx, model.ID)
	if err != nil || len(targets) != 1 {
		t.Fatalf("half-open routes=%d error=%v", len(targets), err)
	}
	probe, err := f.services.Catalog.RoutedChatClient(f.ctx, targets[0])
	if err != nil {
		t.Fatal(err)
	}
	defer probe.Close()
	if second, err := f.services.Catalog.RoutedChatClient(f.ctx, targets[0]); err == nil {
		second.Close()
		t.Fatal("parallel half-open probe allowed")
	}
	failing.Store(false)
	events, err := probe.ChatStream(f.ctx, upstream.ChatRequest{Model: "circuit", Messages: []upstream.Message{{Role: "user", Content: json.RawMessage(`"test"`)}}})
	if err != nil {
		t.Fatal(err)
	}
	for range events {
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		page, err := f.services.Catalog.Channels(f.ctx, catalog.Filter{Limit: 20})
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Items) == 1 && page.Items[0].CircuitState == "closed" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("successful probe did not close circuit")
		}
		time.Sleep(10 * time.Millisecond)
	}
}
