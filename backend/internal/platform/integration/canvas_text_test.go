//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/xinghenWink/Lumi/backend/internal/canvas"
	"github.com/xinghenWink/Lumi/backend/internal/catalog"
	"github.com/xinghenWink/Lumi/backend/migrations"
)

func TestCanvasTextRuns(t *testing.T) {
	f := accountFixtureWithMigrations(t, func(ctx context.Context, pool *pgxpool.Pool) (result error) {
		conn := stdlib.OpenDB(*pool.Config().ConnConfig)
		defer func() { result = errors.Join(result, conn.Close()) }()
		p, err := goose.NewProvider(goose.DialectPostgres, conn, os.DirFS("../../../migrations"),
			goose.WithTableName("public.goose_db_version"), goose.WithDisableGlobalRegistry(true))
		if err != nil {
			return err
		}
		_, err = p.UpTo(ctx, 11)
		return err
	})
	admin := creditActor(t, f)
	member := creditMember(t, f, admin, 0)
	other := creditMember(t, f, admin, 0)
	actor := canvasActor(t, f, member)
	client, otherClient := f.client(t), f.client(t)
	token := f.login(t, client, member.Email, "Integration-password-1").AccessToken
	otherToken := f.login(t, otherClient, other.Email, "Integration-password-1").AccessToken
	board, err := f.services.Canvas.Create(f.ctx, actor, canvas.CreateInput{ID: uuid.New(), Title: "Before text generation"})
	if err != nil {
		t.Fatal(err)
	}
	if err := migrations.Up(f.ctx, f.pool); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/canvases/" + board.ID.String()
	previous := decodeReply[canvas.Canvas](t, f.call(t, client, http.MethodGet, path, token, nil))
	if previous.Title != board.Title || previous.Version != board.Version {
		t.Fatal("text migration changed existing canvas")
	}
	calls := make(chan string, 5)
	var cancellationCalls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Effort   string          `json:"reasoning_effort"`
			Messages json.RawMessage `json:"messages"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&input); err != nil {
			w.WriteHeader(400)
			return
		}
		calls <- input.Effort + ":" + string(input.Messages)
		if strings.Contains(string(input.Messages), "Cancel marker") && cancellationCalls.Add(1) > 1 {
			select {
			case <-r.Context().Done():
			case <-time.After(8 * time.Second):
			}
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		if _, err := io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"New text\"}}]}\n\ndata: [DONE]\n\n"); err != nil {
			t.Error(err)
		}
	}))
	defer upstream.Close()
	channel, err := f.services.Catalog.SaveChannel(f.ctx, admin, uuid.Nil, catalog.ChannelInput{Name: "Canvas text fixture", BaseURL: upstream.URL + "/v1", APIKey: new("fixture"), TimeoutChatS: 5, TimeoutImageS: 5, Weight: 1, Enabled: true, EditFormat: "multipart"})
	if err != nil {
		t.Fatal(err)
	}
	model, err := f.services.Catalog.SaveModel(f.ctx, admin, uuid.Nil, catalog.ModelInput{DisplayName: "Canvas chat", Type: "chat", Enabled: true, Capabilities: catalog.Capabilities{Vision: true, Stream: true, MaxContextTokens: 10000, ReasoningEffort: true}, Routes: []catalog.RouteInput{{UpstreamID: channel.ID, UpstreamModelName: "test", Weight: 1, Enabled: true}}})
	if err != nil {
		t.Fatal(err)
	}
	file, err := f.services.Files.Upload(f.ctx, actor, "upload", canvasPNG(t), 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	noteID, imageID := uuid.New(), uuid.New()
	doc := board.Document
	doc.Nodes = []canvas.Node{
		{ID: noteID, Kind: canvas.KindText, W: 260, H: 140, Text: &canvas.TextContent{Content: "Original draft"}, TextSettings: &canvas.TextSettings{Prompt: "Revise using @[picture]", Mentions: []canvas.Mention{{NodeID: imageID, Token: "@[picture]"}}, Count: 2}},
		{ID: imageID, Kind: canvas.KindImage, W: 280, H: 280, Image: &canvas.ImageContent{State: canvas.StateReady, FileID: &file.ID}},
	}
	doc.Edges = []canvas.Edge{{ID: uuid.New(), From: imageID, To: noteID, Kind: canvas.EdgeInput}}
	board, err = f.services.Canvas.Save(f.ctx, actor, board.ID, canvas.SaveInput{Title: board.Title, Document: doc, Version: board.Version})
	if err != nil {
		t.Fatal(err)
	}
	input := canvas.TextRunInput{Version: board.Version, NodeID: noteID, ModelID: model.ID, Reasoning: "high", Count: 2}
	key := uuid.NewString()
	submit := f.call(t, client, http.MethodPost, path+"/text-runs", token, input, key)
	expectStatus(t, submit, 202)
	run := decodeReply[canvas.TextSubmission](t, submit)
	if len(run.Canvas.Document.Nodes) != 4 || run.Canvas.Document.Nodes[0].Text.Content != "Original draft" || len(run.Task.Items) != 2 {
		t.Fatal("text candidates did not preserve the source or allocate slots")
	}
	replay := decodeReply[canvas.TextSubmission](t, f.call(t, client, http.MethodPost, path+"/text-runs", token, input, key))
	if replay.Task.ID != run.Task.ID {
		t.Fatal("idempotent replay made a second run")
	}
	expectStatus(t, f.call(t, client, http.MethodPost, path+"/text-runs", token, input, uuid.NewString()), 409)
	different := input
	different.Count = 1
	expectStatus(t, f.call(t, client, http.MethodPost, path+"/text-runs", token, different, key), 409)
	runPath := path + "/text-runs/" + run.Task.ID.String()
	expectStatus(t, f.call(t, otherClient, http.MethodGet, runPath, otherToken, nil), 404)
	ctx, stop := context.WithCancel(f.ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		f.services.Canvas.WorkText(ctx, f.services.Chat, slog.New(slog.NewTextHandler(io.Discard, nil)))
	}()
	defer func() { stop(); <-done }()
	for range 2 {
		select {
		case wire := <-calls:
			if !strings.HasPrefix(wire, "high:") || !strings.Contains(wire, "Original draft") ||
				!strings.Contains(wire, "[Image 1]") || !strings.Contains(wire, "image_url") {
				t.Fatal("reasoning, original text or image reference missing from upstream call")
			}
		case <-time.After(6 * time.Second):
			t.Fatal("text worker did not call the upstream")
		}
	}
	waitForText := func(path string, count int) {
		t.Helper()
		for attempt := 0; attempt < 50; attempt++ {
			view := decodeReply[canvas.TextRun](t, f.call(t, client, http.MethodGet, path, token, nil))
			completed := 0
			for _, item := range view.Items {
				if item.Content == "New text" && item.Status == "succeeded" {
					completed++
				}
			}
			if completed == count {
				return
			}
			time.Sleep(50 * time.Millisecond)
		}
		t.Fatal("text results did not settle")
	}
	waitForText(runPath, 2)

	doc = run.Canvas.Document
	doc.Nodes[0].TextSettings.Prompt = "Cancel marker @[picture]"
	board, err = f.services.Canvas.Save(f.ctx, actor, board.ID, canvas.SaveInput{Title: board.Title, Document: doc, Version: run.Canvas.Version})
	if err != nil {
		t.Fatal(err)
	}
	input.Version = board.Version
	next := decodeReply[canvas.TextSubmission](t, f.call(t, client, http.MethodPost, path+"/text-runs", token, input, uuid.NewString()))
	nextPath := path + "/text-runs/" + next.Task.ID.String()
	waitForText(nextPath, 1)
	expectStatus(t, f.call(t, otherClient, http.MethodPost, nextPath+"/cancel", otherToken, nil), 404)
	canceled := decodeReply[canvas.TextRun](t, f.call(t, client, http.MethodPost, nextPath+"/cancel", token, nil))
	statuses := map[string]int{}
	for _, item := range canceled.Items {
		statuses[item.Status]++
	}
	if statuses["succeeded"] != 1 || statuses["canceled"] != 1 {
		t.Fatalf("cancel did not preserve completed candidate: %v", statuses)
	}
}
