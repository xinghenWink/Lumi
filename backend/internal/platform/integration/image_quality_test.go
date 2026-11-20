//go:build integration

package integration_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pressly/goose/v3"
	"github.com/xinghenWink/Lumi/backend/internal/catalog"
	"github.com/xinghenWink/Lumi/backend/internal/credits"
	"github.com/xinghenWink/Lumi/backend/internal/images"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/upstream"
	"github.com/xinghenWink/Lumi/backend/internal/user"
	"github.com/xinghenWink/Lumi/backend/migrations"
)

func TestAdvancedImageQualities(t *testing.T) {
	f := accountFixtureWithMigrations(t, func(ctx context.Context, pool *pgxpool.Pool) error {
		return withUpgradeProvider(ctx, pool, func(p *goose.Provider) error {
			_, err := p.UpTo(ctx, 21)
			return err
		})
	})
	admin := creditActor(t, f)
	prices := creditPricing(t, f, admin, 0)
	member := creditMember(t, f, admin, 100)
	record, err := query.New(f.pool).GetUserByEmail(f.ctx, member.Email)
	if err != nil {
		t.Fatal(err)
	}
	actor := user.Actor{ID: member.ID, TokenVersion: record.TokenVersion, IP: admin.IP}
	bitmap := base64.StdEncoding.EncodeToString(canvasPNG(t))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input upstream.ImageRequest
		switch r.URL.Path {
		case "/v1/images/generations":
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				http.Error(w, "invalid generation body", http.StatusBadRequest)
				return
			}
		case "/v1/images/edits":
			r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
			reader, err := r.MultipartReader()
			if err != nil {
				http.Error(w, "invalid edit content type", http.StatusBadRequest)
				return
			}
			form, err := reader.ReadForm(1 << 20)
			if err != nil {
				http.Error(w, "invalid edit body", http.StatusBadRequest)
				return
			}
			defer func() {
				if err := form.RemoveAll(); err != nil {
					t.Error(err)
				}
			}()
			input.Quality = strings.Join(form.Value["quality"], "")
			input.Prompt = strings.Join(form.Value["prompt"], "")
		default:
			http.NotFound(w, r)
			return
		}
		if input.Prompt != input.Quality || (input.Quality == "max") != (r.URL.Path == "/v1/images/edits") {
			http.Error(w, "wrong image route or quality", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{"data": []map[string]string{{"b64_json": bitmap}}}); err != nil {
			t.Error(err)
		}
	}))
	defer server.Close()
	key := "image-quality-fixture"
	channel, err := f.services.Catalog.SaveChannel(f.ctx, admin, uuid.Nil, catalog.ChannelInput{
		Name: "Image quality fixture", BaseURL: server.URL + "/v1", APIKey: &key,
		TimeoutChatS: 5, TimeoutImageS: 5, Weight: 1, Enabled: true, EditFormat: "multipart",
	})
	if err != nil {
		t.Fatal(err)
	}
	config := catalog.ModelInput{
		DisplayName: "Image quality fixture", Type: "image", Enabled: true,
		Capabilities: catalog.Capabilities{
			Qualities: []string{"low"}, Sizes: []string{"1024x1024"}, MaxN: 1,
			SupportsEdit: true, MaxReferenceImages: 1, ResponseFormat: "b64_json",
		},
		Routes: []catalog.RouteInput{{UpstreamID: channel.ID, UpstreamModelName: "image-2.6", Weight: 1, Enabled: true}},
	}
	model, err := f.services.Catalog.SaveModel(f.ctx, admin, uuid.Nil, config)
	if err != nil {
		t.Fatal(err)
	}
	service := f.services.Images
	conversation, err := service.CreateConversation(f.ctx, actor, uuid.New(), model.ID)
	if err != nil {
		t.Fatal(err)
	}
	submit := func(quality string, references ...uuid.UUID) (images.Task, error) {
		t.Helper()
		return service.Submit(f.ctx, actor, uuid.NewString(), images.Input{
			ConversationID: conversation.ID, ModelID: model.ID, Quality: quality, Prompt: quality,
			Size: "1024x1024", Count: 1, ReferenceFileIDs: references,
		})
	}
	finish := func(id uuid.UUID, quality, operation string, cost int64) images.Task {
		t.Helper()
		task, claimed, err := service.Claim(f.ctx, id)
		if err != nil || !claimed {
			t.Fatalf("claim=%v error=%v", claimed, err)
		}
		service.Execute(f.ctx, task)
		view, err := service.Get(f.ctx, actor, id, false)
		if err != nil || view.Status != "succeeded" || view.Quality != quality ||
			view.Operation != operation || view.ActualCost != cost || len(view.Items) != 1 || view.Items[0].FileID == nil {
			t.Fatalf("unexpected task: %+v error=%v", view, err)
		}
		return view
	}
	legacy, err := submit("low")
	if err != nil {
		t.Fatal(err)
	}
	if err := migrations.Up(f.ctx, f.pool); err != nil {
		t.Fatal(err)
	}
	reference := *finish(legacy.ID, "low", "generate", 5).Items[0].FileID
	legacyQuote, err := f.services.Credits.Quote(f.ctx, credits.QuoteInput{Operation: "generate", Quality: "low", Size: "1024x1024", Count: 1})
	if err != nil || legacyQuote.UnitPrice != 5 {
		t.Fatalf("legacy pricing changed: %+v, %v", legacyQuote, err)
	}

	prices.Rules = append(prices.Rules, credits.Rule{Operation: "generate", Quality: "xhigh", CreditsPerImage: 11, Enabled: true})
	generate := &prices.Rules[len(prices.Rules)-1]
	if _, err := f.services.Credits.SavePricing(f.ctx, admin, prices); creditCode(err) != "INVALID_INPUT" {
		t.Fatalf("global advanced pricing should be rejected: %v", err)
	}
	generate.ModelID = &model.ID
	prices.Rules = append(prices.Rules, credits.Rule{ModelID: &model.ID, Operation: "edit", Quality: "max", CreditsPerImage: 17, Enabled: true})
	if _, err := f.services.Credits.SavePricing(f.ctx, admin, prices); err != nil {
		t.Fatal(err)
	}
	if _, err := submit("xhigh"); creditCode(err) != "INVALID_INPUT" {
		t.Fatalf("a priced tier must still be enabled for the model: %v", err)
	}
	config.Version = model.Version
	config.Capabilities.Qualities = []string{"low", "medium", "high", "xhigh", "max"}
	if _, err := f.services.Catalog.SaveModel(f.ctx, admin, model.ID, config); err != nil {
		t.Fatal(err)
	}
	if _, err := submit("max"); creditCode(err) != "PRICE_UNAVAILABLE" {
		t.Fatalf("an edit price must not enable generation: %v", err)
	}
	before := creditBalance(t, f, actor.ID)
	for _, tc := range []struct {
		quality, operation string
		cost               int64
		references         []uuid.UUID
	}{
		{quality: "xhigh", operation: "generate", cost: 11},
		{quality: "max", operation: "edit", cost: 17, references: []uuid.UUID{reference}},
	} {
		task, err := submit(tc.quality, tc.references...)
		if err != nil {
			t.Fatal(err)
		}
		finish(task.ID, tc.quality, tc.operation, tc.cost)
		filter := images.Filter{Quality: tc.quality, Limit: 10}
		list, err := service.List(f.ctx, actor, filter, false)
		if err != nil || len(list.Items) != 1 || list.Items[0].ID != task.ID {
			t.Fatalf("quality-filtered history=%+v error=%v", list, err)
		}
		gallery, err := service.Gallery(f.ctx, actor.ID, filter)
		if err != nil || len(gallery.Items) != 1 || gallery.Items[0].TaskID != task.ID || gallery.Items[0].Quality != tc.quality {
			t.Fatalf("quality-filtered gallery=%+v error=%v", gallery, err)
		}
	}
	if after := creditBalance(t, f, actor.ID); before.Total-after.Total != 28 {
		t.Fatalf("advanced image charges consumed %d credits", before.Total-after.Total)
	}
	usage, err := f.services.Credits.Usage(f.ctx, actor.ID)
	if err != nil || usage.ImagesByQuality["xhigh"] != 1 || usage.ImagesByQuality["max"] != 1 {
		t.Fatalf("advanced image usage=%+v error=%v", usage, err)
	}
}
