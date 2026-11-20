//go:build integration

package integration_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/xinghenWink/Lumi/backend/internal/canvas"
	"github.com/xinghenWink/Lumi/backend/internal/catalog"
	"github.com/xinghenWink/Lumi/backend/internal/images"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

func canvasPNG(t *testing.T) []byte {
	t.Helper()
	var bitmap bytes.Buffer
	img := image.NewNRGBA(image.Rect(0, 0, 40, 30))
	img.SetNRGBA(1, 1, color.NRGBA{G: 120, A: 255})
	if err := png.Encode(&bitmap, img); err != nil {
		t.Fatal(err)
	}
	return bitmap.Bytes()
}

func canvasActor(t *testing.T, f *fixture, profile user.Profile) user.Actor {
	t.Helper()
	record, err := query.New(f.pool).GetUserByEmail(f.ctx, profile.Email)
	if err != nil {
		t.Fatal(err)
	}
	return user.Actor{ID: record.ID, TokenVersion: record.TokenVersion}
}

func errorCode(t *testing.T, response reply) string {
	t.Helper()
	var failure struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(response.body, &failure); err != nil {
		t.Fatal(err)
	}
	return failure.Code
}

func TestCanvasRebuildPersistenceGenerationAndRetention(t *testing.T) {
	testCanvas(t, newAccountFixture(t), false)
}

func TestCanvasRebuildUpgrade(t *testing.T) {
	f := accountFixtureWithMigrations(t, func(ctx context.Context, pool *pgxpool.Pool) error {
		return withUpgradeProvider(ctx, pool, func(p *goose.Provider) error {
			if _, err := p.UpTo(ctx, 10); err != nil {
				return err
			}
			// Seed legacy canvas tasks through the current image service before migration 11.
			for _, version := range []int64{13, 16, 21} {
				if _, err := p.ApplyVersion(ctx, version, true); err != nil {
					return err
				}
			}
			return nil
		})
	})
	testCanvas(t, f, true)
}

func withUpgradeProvider(ctx context.Context, pool *pgxpool.Pool, work func(*goose.Provider) error) (result error) {
	conn := stdlib.OpenDB(*pool.Config().ConnConfig)
	defer func() { result = errors.Join(result, conn.Close()) }()
	provider, err := goose.NewProvider(goose.DialectPostgres, conn, os.DirFS("../../../migrations"),
		goose.WithTableName("public.goose_db_version"), goose.WithDisableGlobalRegistry(true), goose.WithAllowOutofOrder(true))
	if err != nil {
		return err
	}
	return work(provider)
}

func testCanvas(t *testing.T, f *fixture, upgrade bool) {
	t.Helper()
	admin := creditActor(t, f)
	creditPricing(t, f, admin, 0)
	member := creditMember(t, f, admin, 10000)
	other := creditMember(t, f, admin, 0)
	actor, otherActor := canvasActor(t, f, member), canvasActor(t, f, other)
	client, otherClient := f.client(t), f.client(t)
	token := f.login(t, client, member.Email, "Integration-password-1").AccessToken
	otherToken := f.login(t, otherClient, other.Email, "Integration-password-1").AccessToken
	bitmap := canvasPNG(t)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Count int `json:"n"`
		}
		if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/") {
			r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
			input.Count = 1
			_, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if err != nil {
				w.WriteHeader(400)
				return
			}
			form, err := multipart.NewReader(r.Body, params["boundary"]).ReadForm(2 << 20)
			if err != nil {
				w.WriteHeader(400)
				return
			}
			defer func() {
				if err := form.RemoveAll(); err != nil {
					t.Error(err)
				}
			}()
			if !strings.Contains(strings.Join(form.Value["prompt"], ""), "暖色调") {
				w.WriteHeader(400)
				return
			}
		} else if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			w.WriteHeader(400)
			return
		}
		data := make([]map[string]string, 0, input.Count)
		for range input.Count {
			data = append(data, map[string]string{"b64_json": base64.StdEncoding.EncodeToString(bitmap)})
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{"data": data}); err != nil {
			return
		}
	}))
	defer upstream.Close()
	key := "canvas-fixture-only"
	channel, err := f.services.Catalog.SaveChannel(f.ctx, admin, uuid.Nil, catalog.ChannelInput{Name: "Canvas fixture", BaseURL: upstream.URL + "/v1", APIKey: &key, TimeoutChatS: 5, TimeoutImageS: 5, Weight: 1, Enabled: true, EditFormat: "multipart"})
	if err != nil {
		t.Fatal(err)
	}
	model, err := f.services.Catalog.SaveModel(f.ctx, admin, uuid.Nil, catalog.ModelInput{DisplayName: "画布图片", Type: "image", Enabled: true, Capabilities: catalog.Capabilities{Qualities: []string{"low"}, Sizes: []string{"1024x1024"}, MaxN: 4, SupportsEdit: true, MaxReferenceImages: 4, ResponseFormat: "b64_json"}, Routes: []catalog.RouteInput{{UpstreamID: channel.ID, UpstreamModelName: "canvas-image-model", Weight: 1, Enabled: true}}})
	if err != nil {
		t.Fatal(err)
	}

	id := uuid.New()
	created := f.call(t, client, "POST", "/api/v1/canvases", token, canvas.CreateInput{ID: id, Title: " 第一张画布 "})
	expectStatus(t, created, 201)
	board := decodeReply[canvas.Canvas](t, created)
	if board.Title != "第一张画布" || board.Version != 1 || board.ConversationID == uuid.Nil || len(board.Document.Nodes) != 0 || board.Document.Viewport.Zoom != 1 || len(board.Files) != 0 {
		t.Fatalf("unexpected new canvas: %+v", board)
	}

	t.Run("create is idempotent and owner scoped", func(t *testing.T) {
		replay := decodeReply[canvas.Canvas](t, f.call(t, client, "POST", "/api/v1/canvases", token, canvas.CreateInput{ID: id, Title: "ignored"}))
		if replay.ConversationID != board.ConversationID || replay.Title != board.Title {
			t.Fatal("replayed create changed the canvas")
		}
		expectStatus(t, f.call(t, otherClient, "GET", "/api/v1/canvases/"+id.String(), otherToken, nil), 404)
		taken := f.call(t, otherClient, "POST", "/api/v1/canvases", otherToken, canvas.CreateInput{ID: id})
		if taken.status != 404 || errorCode(t, taken) != "CANVAS_NOT_FOUND" {
			t.Fatalf("another user claimed an existing canvas ID: %d", taken.status)
		}
		expectStatus(t, f.call(t, client, "POST", "/api/v1/canvases", token, map[string]any{"id": uuid.New(), "title": "x", "extra": true}), 400)
		page := decodeReply[canvas.Page](t, f.call(t, client, "GET", "/api/v1/canvases?search=%E7%AC%AC%E4%B8%80", token, nil))
		if len(page.Items) != 1 || page.Items[0].ID != id || page.Items[0].Cover != nil {
			t.Fatalf("unexpected list: %+v", page.Items)
		}
		if empty := decodeReply[canvas.Page](t, f.call(t, otherClient, "GET", "/api/v1/canvases", otherToken, nil)); len(empty.Items) != 0 {
			t.Fatal("canvas leaked to another user")
		}
	})

	t.Run("canvas conversation stays out of image history", func(t *testing.T) {
		history := decodeReply[struct {
			Items []images.Conversation `json:"items"`
		}](t, f.call(t, client, "GET", "/api/v1/image-conversations", token, nil))
		for _, row := range history.Items {
			if row.ID == board.ConversationID {
				t.Fatal("canvas conversation listed as image history")
			}
		}
		expectStatus(t, f.call(t, client, "GET", "/api/v1/image-conversations/"+board.ConversationID.String(), token, nil), 404)
		expectStatus(t, f.call(t, client, "DELETE", "/api/v1/image-conversations/"+board.ConversationID.String(), token, nil), 404)
	})

	upload, err := f.services.Files.Upload(f.ctx, actor, "upload", bitmap, 10<<20)
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := f.services.Files.Upload(f.ctx, otherActor, "upload", bitmap, 10<<20)
	if err != nil {
		t.Fatal(err)
	}
	imageNode, textNode, generatorNode := uuid.New(), uuid.New(), uuid.New()
	doc := canvas.Empty()
	doc.Viewport = canvas.Viewport{X: 120, Y: -40, Zoom: 0.75}
	doc.Nodes = []canvas.Node{
		{ID: imageNode, Kind: canvas.KindImage, W: 400, H: 300, Image: &canvas.ImageContent{State: canvas.StateReady, FileID: &upload.ID}},
		{ID: textNode, Kind: canvas.KindText, Y: 340, W: 240, H: 120, Text: &canvas.TextContent{Content: "暖色调\n胶片质感"}},
		{ID: generatorNode, Kind: canvas.KindGenerator, X: 500, W: 320, H: 240, Generator: &canvas.GeneratorContent{Prompt: "一只猫", Quality: "max", Count: 1}},
	}
	doc.Edges = []canvas.Edge{{ID: uuid.New(), From: imageNode, To: generatorNode, Kind: canvas.EdgeInput}, {ID: uuid.New(), From: textNode, To: generatorNode, Kind: canvas.EdgeInput}}
	path := "/api/v1/canvases/" + id.String()

	t.Run("save validates version, files and size", func(t *testing.T) {
		saved := f.call(t, client, "PUT", path, token, canvas.SaveInput{Title: "已改名", Document: doc, Version: 1})
		expectStatus(t, saved, 200)
		board = decodeReply[canvas.Canvas](t, saved)
		if board.Version != 2 || board.Title != "已改名" || board.NodeCount != 3 || len(board.Document.Edges) != 2 || board.Document.Viewport.Zoom != 0.75 {
			t.Fatalf("unexpected saved canvas: %+v", board)
		}
		if len(board.Files) != 1 || board.Files[0].ID != upload.ID || !strings.Contains(board.Files[0].URL, "sig=") {
			t.Fatal("saved canvas did not sign its files")
		}
		expectStatus(t, f.call(t, client, "GET", board.Files[0].ThumbnailURL, token, nil), 200)
		stale := f.call(t, client, "PUT", path, token, canvas.SaveInput{Title: "旧版本", Document: doc, Version: 1})
		if stale.status != 409 || errorCode(t, stale) != "CANVAS_CONFLICT" {
			t.Fatalf("stale save status=%d", stale.status)
		}
		borrowed := doc
		borrowed.Nodes = append([]canvas.Node{}, doc.Nodes...)
		borrowed.Nodes[0].Image = &canvas.ImageContent{State: canvas.StateReady, FileID: &foreign.ID}
		expectStatus(t, f.call(t, client, "PUT", path, token, canvas.SaveInput{Document: borrowed, Version: board.Version}), 400)
		broken := doc
		broken.Edges = []canvas.Edge{{ID: uuid.New(), From: generatorNode, To: textNode}}
		expectStatus(t, f.call(t, client, "PUT", path, token, canvas.SaveInput{Document: broken, Version: board.Version}), 400)
		huge := canvas.Empty()
		huge.Nodes = []canvas.Node{{ID: uuid.New(), Kind: canvas.KindText, W: 100, H: 100, Text: &canvas.TextContent{Content: strings.Repeat("a", canvas.MaxRequestBytes)}}}
		expectStatus(t, f.call(t, client, "PUT", path, token, canvas.SaveInput{Document: huge, Version: board.Version}), 400)
		expectStatus(t, f.call(t, otherClient, "PUT", path, otherToken, canvas.SaveInput{Document: doc, Version: board.Version}), 404)
		reloaded := decodeReply[canvas.Canvas](t, f.call(t, client, "GET", path, token, nil))
		if reloaded.Version != board.Version || len(reloaded.Document.Nodes) != 3 {
			t.Fatal("rejected saves changed the canvas")
		}
		if generator := reloaded.Document.Nodes[2].Generator; generator == nil || generator.Quality != "max" {
			t.Fatal("the reloaded generator lost the selected quality")
		}
		page := decodeReply[canvas.Page](t, f.call(t, client, "GET", "/api/v1/canvases", token, nil))
		if len(page.Items) != 1 || page.Items[0].Cover == nil || page.Items[0].Cover.ID != upload.ID {
			t.Fatal("list did not expose the cover image")
		}
	})

	t.Run("generation runs in the canvas conversation", func(t *testing.T) {
		before := creditBalance(t, f, member.ID)
		input := canvas.RunInput{Version: board.Version, NodeID: generatorNode, ModelID: model.ID, Quality: "low", Size: "1024x1024", Count: 1}
		key := uuid.NewString()
		expectStatus(t, f.call(t, otherClient, "POST", path+"/runs", otherToken, input, key), 404)
		submitted := f.call(t, client, "POST", path+"/runs", token, input, key)
		expectStatus(t, submitted, 202)
		run := decodeReply[canvas.Run](t, submitted)
		task := run.Task
		board = run.Canvas
		if task.Prompt != "一只猫\n\n暖色调\n胶片质感" || len(task.ReferenceFileIDs) != 1 || len(board.Document.Nodes) != 4 {
			t.Fatalf("run did not persist or resolve inputs: %+v", task)
		}
		replay := decodeReply[canvas.Run](t, f.call(t, client, "POST", path+"/runs", token, input, key))
		if replay.Task.ID != task.ID || creditBalance(t, f, member.ID).Total != before.Total-task.TotalCost {
			t.Fatal("replay created another charge or task")
		}
		expectStatus(t, f.call(t, client, "POST", path+"/runs", token, input, uuid.NewString()), 409)
		input.Count = 2
		expectStatus(t, f.call(t, client, "POST", path+"/runs", token, input, key), 409)
		if after := creditBalance(t, f, member.ID); after.Total >= before.Total {
			t.Fatal("canvas generation was not charged")
		}
		claimed, ok, err := f.services.Images.Claim(f.ctx, task.ID)
		if err != nil || !ok {
			t.Fatalf("claim=%v error=%v", ok, err)
		}
		f.services.Images.Execute(f.ctx, claimed)
		finished := decodeReply[images.Task](t, f.call(t, client, "GET", "/api/v1/image-tasks/"+task.ID.String(), token, nil))
		if finished.Status != "succeeded" || len(finished.Items) != 1 || finished.Items[0].FileID == nil {
			t.Fatalf("canvas task did not finish: %s", finished.Status)
		}
		listed := decodeReply[struct {
			Items []images.Task `json:"items"`
		}](t, f.call(t, client, "GET", "/api/v1/image-tasks?conversation_id="+board.ConversationID.String(), token, nil))
		if len(listed.Items) != 1 || listed.Items[0].ID != task.ID {
			t.Fatal("canvas tasks not listed by conversation")
		}
		withResult := board.Document
		withResult.Nodes[3].Image.State = canvas.StateReady
		withResult.Nodes[3].Image.FileID = finished.Items[0].FileID
		saved := f.call(t, client, "PUT", path, token, canvas.SaveInput{Title: board.Title, Document: withResult, Version: board.Version})
		expectStatus(t, saved, 200)
		board = decodeReply[canvas.Canvas](t, saved)
		if len(board.Files) != 2 {
			t.Fatal("generated file was not signed")
		}
		// A task from another conversation cannot be attached to this canvas.
		conversation, err := f.services.Images.CreateConversation(f.ctx, actor, uuid.New(), model.ID)
		if err != nil {
			t.Fatal(err)
		}
		elsewhere, err := f.services.Images.Submit(f.ctx, actor, uuid.NewString(), images.Input{ConversationID: conversation.ID, ModelID: model.ID, Prompt: "elsewhere", Quality: "low", Size: "1024x1024", Count: 1})
		if err != nil {
			t.Fatal(err)
		}
		borrowed := board.Document
		borrowed.Nodes = append([]canvas.Node{}, board.Document.Nodes...)
		borrowed.Nodes = append(borrowed.Nodes, canvas.Node{ID: uuid.New(), Kind: canvas.KindImage, W: 100, H: 100, Image: &canvas.ImageContent{State: canvas.StatePending, TaskID: &elsewhere.ID, Position: new(int32)}})
		expectStatus(t, f.call(t, client, "PUT", path, token, canvas.SaveInput{Document: borrowed, Version: board.Version}), 400)
		if upgrade {
			ordinary, ok, err := f.services.Images.Claim(f.ctx, elsewhere.ID)
			if err != nil || !ok {
				t.Fatalf("claim ordinary image: %v", err)
			}
			f.services.Images.Execute(f.ctx, ordinary)
			normal, err := f.services.Images.Get(f.ctx, actor, elsewhere.ID, false)
			if err != nil || normal.Status != "succeeded" {
				t.Fatalf("ordinary image: %v, %s", err, normal.Status)
			}
			queued, err := f.services.Canvas.Run(f.ctx, f.services.Images, actor, id, uuid.NewString(), canvas.RunInput{
				Version: board.Version, NodeID: generatorNode, ModelID: model.ID, Quality: "low", Size: "1024x1024", Count: 1,
			})
			if err != nil {
				t.Fatal(err)
			}
			running, ok, err := f.services.Images.Claim(f.ctx, queued.Task.ID)
			if err != nil || !ok {
				t.Fatalf("claim old canvas task: %v", err)
			}
			if _, err := f.pool.Exec(f.ctx, "UPDATE canvases SET document=jsonb_set(document,'{schema}','1') WHERE id=$1", id); err != nil {
				t.Fatal(err)
			}
			if err := withUpgradeProvider(f.ctx, f.pool, func(p *goose.Provider) error {
				_, err := p.Up(f.ctx)
				return err
			}); err != nil {
				t.Fatal(err)
			}
			f.services.Images.Execute(f.ctx, running)
			if err := f.services.Images.Recover(f.ctx); err != nil {
				t.Fatal(err)
			}
			canceled, err := f.services.Images.Get(f.ctx, actor, running.ID, false)
			if err != nil || canceled.Status != "canceled" || canceled.RefundedCost != canceled.TotalCost {
				t.Fatalf("old canvas task was not refunded: %v, %+v", err, canceled)
			}
			expectStatus(t, f.call(t, client, "GET", path, token, nil), 404)
			list := decodeReply[canvas.Page](t, f.call(t, client, "GET", "/api/v1/canvases", token, nil))
			if len(list.Items) != 0 {
				t.Fatal("old canvases survived")
			}
			if _, err := f.services.Files.Get(f.ctx, actor.ID, *finished.Items[0].FileID); err == nil {
				t.Fatal("old canvas generation survived")
			}
			if normal.Items[0].FileID == nil {
				t.Fatal("ordinary generation missing")
			}
			if _, err := f.services.Files.Get(f.ctx, actor.ID, *normal.Items[0].FileID); err != nil {
				t.Fatal("ordinary generation removed", err)
			}
			newBoard := decodeReply[canvas.Canvas](t, f.call(t, client, "POST", "/api/v1/canvases", token, canvas.CreateInput{ID: uuid.New()}))
			if newBoard.Document.Schema != 2 || len(newBoard.Document.Nodes) != 0 {
				t.Fatal("new board is not an empty v2 document")
			}
		}
	})
	if upgrade {
		return
	}

	t.Run("placed uploads survive expiry until the canvas is deleted", func(t *testing.T) {
		stray, err := f.services.Files.Upload(f.ctx, actor, "upload", bitmap, 10<<20)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.pool.Exec(f.ctx, "UPDATE files SET created_at=now()-interval '2 days' WHERE id=ANY($1)", []uuid.UUID{upload.ID, stray.ID}); err != nil {
			t.Fatal(err)
		}
		if err := f.services.Files.Cleanup(f.ctx, 0); err != nil {
			t.Fatal(err)
		}
		if _, err := f.services.Files.Get(f.ctx, actor.ID, upload.ID); err != nil {
			t.Fatal("canvas upload expired", err)
		}
		if _, err := f.services.Files.Get(f.ctx, actor.ID, stray.ID); err == nil {
			t.Fatal("unreferenced upload did not expire")
		}
	})

	t.Run("deleting a canvas cancels its queued tasks", func(t *testing.T) {
		temporary, err := f.services.Files.Upload(f.ctx, actor, "upload", bitmap, 10<<20)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.pool.Exec(f.ctx, "UPDATE files SET created_at=now()-interval '2 days' WHERE id=$1", temporary.ID); err != nil {
			t.Fatal(err)
		}
		newDoc := board.Document
		newDoc.Nodes = append(newDoc.Nodes, canvas.Node{ID: uuid.New(), Kind: canvas.KindImage, W: 200, H: 200, Image: &canvas.ImageContent{State: canvas.StateReady, FileID: &temporary.ID}})
		board, err = f.services.Canvas.Save(f.ctx, actor, board.ID, canvas.SaveInput{Title: board.Title, Document: newDoc, Version: board.Version})
		if err != nil {
			t.Fatal(err)
		}
		run, err := f.services.Canvas.Run(f.ctx, f.services.Images, actor, board.ID, uuid.NewString(), canvas.RunInput{
			Version: board.Version, NodeID: generatorNode, ModelID: model.ID, Quality: "low", Size: "1024x1024", Count: 1,
		})
		if err != nil {
			t.Fatal(err)
		}
		expectStatus(t, f.call(t, otherClient, "DELETE", path, otherToken, nil), 404)
		expectStatus(t, f.call(t, client, "DELETE", path, token, nil), 204)
		expectStatus(t, f.call(t, client, "GET", path, token, nil), 404)
		expectStatus(t, f.call(t, client, "DELETE", path, token, nil), 404)
		if page := decodeReply[canvas.Page](t, f.call(t, client, "GET", "/api/v1/canvases", token, nil)); len(page.Items) != 0 {
			t.Fatal("deleted canvas still listed")
		}
		if err := f.services.Images.Recover(f.ctx); err != nil {
			t.Fatal(err)
		}
		result, err := f.services.Images.Get(f.ctx, actor, run.Task.ID, false)
		if err != nil || result.Status != "canceled" || result.RefundedCost != result.TotalCost {
			t.Fatalf("queued canvas task was not refunded: %s", result.Status)
		}
		if err := f.services.Files.Cleanup(f.ctx, 0); err != nil {
			t.Fatal(err)
		}
		if _, err := f.services.Files.Get(f.ctx, actor.ID, temporary.ID); err == nil {
			t.Fatal("upload stayed protected after its canvas was deleted")
		}
	})

	t.Run("canvas count is limited per user", func(t *testing.T) {
		for range canvas.MaxCanvases {
			if _, err := f.services.Canvas.Create(f.ctx, otherActor, canvas.CreateInput{ID: uuid.New()}); err != nil {
				t.Fatal(err)
			}
		}
		_, err := f.services.Canvas.Create(f.ctx, otherActor, canvas.CreateInput{ID: uuid.New()})
		if creditCode(err) != "CANVAS_LIMIT" {
			t.Fatalf("limit not enforced: %v", err)
		}
	})
}
