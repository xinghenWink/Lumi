//go:build integration

package integration_test

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/canvas"
	"github.com/xinghenWink/Lumi/backend/internal/catalog"
	"github.com/xinghenWink/Lumi/backend/internal/credits"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/upstream/video"
	"github.com/xinghenWink/Lumi/backend/internal/videos"
)

type videoFixture struct {
	submits atomic.Int64
	data    []byte
}

func (f *videoFixture) Submit(context.Context, video.Request) (string, error) {
	return strconv.FormatInt(f.submits.Add(1), 10), nil
}
func (f *videoFixture) Query(_ context.Context, id string) (video.Snapshot, error) {
	if id == "1" {
		return video.Snapshot{ID: id, State: video.Succeeded}, nil
	}
	return video.Snapshot{ID: id, State: video.Failed}, nil
}
func (f *videoFixture) Download(context.Context, video.Snapshot) (io.ReadCloser, error) {
	return io.NopCloser(bytes.NewReader(f.data)), nil
}

func TestVideoCanvasSettlement(t *testing.T) {
	tools, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is required for the video fixture")
	}
	cmd := exec.CommandContext(t.Context(), tools, "-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=24", "-f", "lavfi", "-i", "anullsrc", "-t", "1", "-c:v", "libx264", "-c:a", "aac", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1") // #nosec G204 -- Fixed test fixture command.
	data, err := cmd.Output()
	if err != nil {
		t.Fatal(err)
	}
	remote := &videoFixture{data: data}
	f := newAccountFixture(t)
	admin := creditActor(t, f)
	member := creditMember(t, f, admin, 40)
	actor := canvasActor(t, f, member)
	f.services.Catalog.SetVideoRegistry(video.NewRegistry(map[string]video.Factory{"fixture": func(video.Connection, string) (video.Adapter, error) { return remote, nil }}))
	svc := videos.New(f.pool, f.services.Catalog, f.services.Credits, f.services.Files, "https://lumi.test", slog.New(slog.NewTextHandler(io.Discard, nil)))
	f.services.Videos = svc
	secret := "test-video-credential"
	channel, err := f.services.Catalog.SaveChannel(f.ctx, admin, uuid.Nil, catalog.ChannelInput{Name: "Video fixtures", BaseURL: "https://fixture.test", APIKey: &secret, TimeoutChatS: 30, TimeoutImageS: 30, Enabled: true, Weight: 1, EditFormat: "multipart"})
	if err != nil {
		t.Fatal(err)
	}
	caps := &video.Capabilities{Profiles: []video.Profile{{Mode: video.Text, Ratios: []string{"16:9"}, Resolutions: []string{"720p"}, Durations: []int{5}}}}
	model, err := f.services.Catalog.SaveModel(f.ctx, admin, uuid.Nil, catalog.ModelInput{DisplayName: "Video fixture", Type: "video", Enabled: true, Capabilities: catalog.Capabilities{Video: caps}, Routes: []catalog.RouteInput{{UpstreamID: channel.ID, UpstreamModelName: "test-model", Weight: 1, Enabled: true, VideoProtocol: "fixture"}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.services.Credits.SaveVideoPricing(f.ctx, admin, credits.VideoPricing{ModelID: model.ID, Mode: "second", Rates: []credits.VideoRate{{Resolution: "720p", Credits: 2}}}); err != nil {
		t.Fatal(err)
	}
	if err := f.services.Credits.BatchGrantBucket(f.ctx, admin, []uuid.UUID{actor.ID}, uuid.NewString(), 50, "Video test", "video"); err != nil {
		t.Fatal(err)
	}
	board, err := f.services.Canvas.Create(f.ctx, actor, canvas.CreateInput{ID: uuid.New()})
	if err != nil {
		t.Fatal(err)
	}
	node := uuid.New()
	document := board.Document
	document.Nodes = append(document.Nodes, canvas.Node{ID: node, Kind: canvas.KindVideo, W: 320, H: 180, Video: &canvas.ImageContent{State: canvas.StateEmpty}})
	board, err = f.services.Canvas.Save(f.ctx, actor, board.ID, canvas.SaveInput{Title: board.Title, Version: board.Version, Document: document})
	if err != nil {
		t.Fatal(err)
	}
	input := canvas.VideoQuoteInput{Version: board.Version, NodeID: node, Input: videos.Input{ModelID: model.ID, Count: 2, Prompt: "A blue frame", Options: video.Options{Mode: video.Text, Ratio: "16:9", Resolution: "720p", Duration: 5, GenerateAudio: false}, References: []videos.AssetReference{}}}
	quote, err := f.services.Canvas.VideoQuote(f.ctx, svc, actor, board.ID, input)
	if err != nil || quote.TotalCost != 20 || quote.Pool != "video" {
		t.Fatalf("quote %+v: %v", quote, err)
	}
	request := canvas.VideoRunInput{VideoQuoteInput: input, ConfirmedQuote: quote}
	key := uuid.NewString()
	run, err := f.services.Canvas.RunVideo(f.ctx, svc, actor, board.ID, key, request)
	if err != nil || len(run.Canvas.Document.Nodes) != 2 {
		t.Fatalf("submit %+v: %v", run, err)
	}
	repeated, err := f.services.Canvas.RunVideo(f.ctx, svc, actor, board.ID, key, request)
	if err != nil || repeated.Task.ID != run.Task.ID {
		t.Fatalf("replay %+v: %v", repeated, err)
	}
	if _, err := f.services.Credits.SaveVideoPool(f.ctx, admin, credits.VideoPool{Pool: "permanent", Version: 0}); err != nil {
		t.Fatal(err)
	}
	start := func() func() {
		ctx, cancel := context.WithCancel(f.ctx)
		done := make(chan struct{})
		go func() { defer close(done); svc.Run(ctx) }()
		return func() { cancel(); <-done }
	}
	stop := start()
	submitted := false
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); {
		items, err := query.New(f.pool).GetVideoTaskItems(f.ctx, run.Task.ID)
		if err != nil {
			stop()
			t.Fatal(err)
		}
		if len(items) == 2 && items[0].RemoteID != "" && items[1].RemoteID != "" {
			submitted = true
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	stop()
	if !submitted {
		t.Fatal("did not persist both upstream task IDs")
	}
	defer start()()
	end := time.Now().Add(20 * time.Second)
	for time.Now().Before(end) {
		task, err := svc.Get(f.ctx, actor.ID, run.Task.ID)
		if err != nil {
			t.Fatal(err)
		}
		if task.Status == "partial" {
			if task.Refunded != 10 || remote.submits.Load() != 2 {
				t.Fatalf("settlement %+v", task)
			}
			account, err := f.services.Credits.Read(f.ctx, actor.ID)
			if err != nil || account.VideoBalance != 40 || account.PermanentBalance != 40 {
				t.Fatalf("credits %+v: %v", account, err)
			}
			loaded, err := f.services.Canvas.Get(f.ctx, actor.ID, board.ID)
			if err != nil || len(loaded.Document.Nodes) != 2 {
				t.Fatalf("reload %+v: %v", loaded, err)
			}
			slot := loaded.Document.Nodes[0].Video
			if slot.State != canvas.StateReady || slot.FileID == nil || loaded.Document.Nodes[1].Video.State != canvas.StateFailed {
				t.Fatalf("unexpected video slots: %+v", loaded.Document.Nodes)
			}
			asset, err := svc.Asset(f.ctx, actor.ID, *slot.FileID)
			if err != nil || !strings.HasPrefix(asset.MIME, "video/") {
				t.Fatalf("asset %+v: %v", asset, err)
			}
			req, err := http.NewRequestWithContext(f.ctx, http.MethodGet, f.server.URL+asset.URL, nil)
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("Range", "bytes=0-31")
			response, err := f.client(t).Do(req)
			if err != nil {
				t.Fatal(err)
			}
			raw, err := io.ReadAll(response.Body)
			if closeErr := response.Body.Close(); closeErr != nil {
				t.Error(closeErr)
			}
			if err != nil || response.StatusCode != http.StatusPartialContent || len(raw) != 32 {
				t.Fatalf("range response %d, %d bytes: %v", response.StatusCode, len(raw), err)
			}
			if _, err := svc.Asset(f.ctx, admin.ID, asset.ID); creditCode(err) != "FILE_NOT_FOUND" {
				t.Fatalf("asset ownership: %v", err)
			}
			return
		}
		if task.Status == "failed" {
			t.Fatalf("both slots failed: %+v", task.Items)
		}
		time.Sleep(250 * time.Millisecond)
	}
	t.Fatal("video task did not settle")
}
