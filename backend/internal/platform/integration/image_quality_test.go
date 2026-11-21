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
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
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
			var payload struct {
				upstream.ImageRequest
				Complexity json.RawMessage `json:"complexity"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				http.Error(w, "invalid generation body", http.StatusBadRequest)
				return
			}
			switch payload.Prompt {
			case "planning":
				if string(payload.Complexity) != `"medium"` {
					t.Errorf("explicit planning level was not forwarded: %s", payload.Complexity)
				}
				payload.Prompt = payload.Quality
			default:
				if payload.Complexity != nil {
					t.Errorf("unexpected explicit planning level: %s", payload.Complexity)
				}
			}
			input = payload.ImageRequest
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
	// Seed the old schema without calling the current generated INSERT.
	legacyID := uuid.New()
	legacyCharge, err := f.services.Credits.Charge(f.ctx, actor.ID, "task-charge:"+legacyID.String(), legacyID,
		credits.QuoteInput{ModelID: &model.ID, Operation: "generate", Quality: "low", Size: "1024x1024", Count: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `
		INSERT INTO image_tasks(id,user_id,conversation_id,message_id,user_message_id,model_id,model_name,operation,prompt,params,
			quality,size,image_count,charge_id,unit_price,total_cost,idempotency_key,request_hash,split_requests,timeout_seconds,queue_deadline)
		VALUES($1,$2,$3,$4,$5,$6,$7,'generate','low','{}','low','1024x1024',1,$8,5,5,$9,'legacy-fixture',false,30,now()+interval '5 minutes')`,
		legacyID, actor.ID, conversation.ID, uuid.New(), uuid.New(), model.ID, model.DisplayName, legacyCharge.ID, legacyID.String()); err != nil {
		t.Fatal(err)
	}
	if err := query.New(f.pool).CreateImageTaskItem(f.ctx, query.CreateImageTaskItemParams{TaskID: legacyID}); err != nil {
		t.Fatal(err)
	}
	if err := migrations.Up(f.ctx, f.pool); err != nil {
		t.Fatal(err)
	}
	legacy := finish(legacyID, "low", "generate", 5)
	if legacy.Complexity != "" {
		t.Fatalf("legacy task unexpectedly has a planning level: %q", legacy.Complexity)
	}
	reference := *legacy.Items[0].FileID
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
	model, err = f.services.Catalog.SaveModel(f.ctx, admin, model.ID, config)
	if err != nil {
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

	t.Run("planning level validation, persistence and refund", func(t *testing.T) {
		initial := creditBalance(t, f, actor.ID)
		input := images.Input{
			ConversationID: conversation.ID, ModelID: model.ID, Prompt: "planning",
			Quality: "low", Size: "1024x1024", Count: 1, Complexity: "medium",
		}
		if _, err := service.Submit(f.ctx, actor, uuid.NewString(), input); creditCode(err) != "IMAGE_COMPLEXITY_UNSUPPORTED" {
			t.Fatalf("disabled planning level should be rejected: %v", err)
		}
		config.Version = model.Version
		config.Capabilities.SupportsComplexity = true
		enabled, err := f.services.Catalog.SaveModel(f.ctx, admin, model.ID, config)
		if err != nil {
			t.Fatal(err)
		}
		invalid := input
		invalid.Complexity = "xhigh"
		if _, err := service.Submit(f.ctx, actor, uuid.NewString(), invalid); creditCode(err) != "INVALID_INPUT" {
			t.Fatalf("invalid planning level should be rejected: %v", err)
		}
		if after := creditBalance(t, f, actor.ID); after.Total != initial.Total {
			t.Fatalf("rejected requests charged %d credits", initial.Total-after.Total)
		}

		key := uuid.NewString()
		task, err := service.Submit(f.ctx, actor, key, input)
		if err != nil || task.Complexity != input.Complexity {
			t.Fatalf("submit: complexity = %q, error = %v", task.Complexity, err)
		}
		replay, err := service.Submit(f.ctx, actor, key, input)
		if err != nil || replay.ID != task.ID || replay.Complexity != input.Complexity {
			t.Fatalf("replay: task = %v, complexity = %q, error = %v", replay.ID, replay.Complexity, err)
		}
		different := input
		different.Complexity = "high"
		if _, err := service.Submit(f.ctx, actor, key, different); creditCode(err) != "IDEMPOTENCY_CONFLICT" {
			t.Fatalf("changing planning level should change the request identity: %v", err)
		}
		if completed := finish(task.ID, "low", "generate", 5); completed.Complexity != input.Complexity {
			t.Fatalf("completed task lost planning level: %q", completed.Complexity)
		}

		beforeQueued := creditBalance(t, f, actor.ID)
		queued, err := service.Submit(f.ctx, actor, uuid.NewString(), different)
		if err != nil {
			t.Fatal(err)
		}
		config.Version = enabled.Version
		config.Capabilities.SupportsComplexity = false
		if _, err := f.services.Catalog.SaveModel(f.ctx, admin, model.ID, config); err != nil {
			t.Fatal(err)
		}
		claim, claimed, err := service.Claim(f.ctx, queued.ID)
		if err != nil || !claimed {
			t.Fatalf("claim=%v error=%v", claimed, err)
		}
		service.Execute(f.ctx, claim)
		view, err := service.Get(f.ctx, actor, queued.ID, false)
		if err != nil || view.Status != "failed" || view.ErrorCode != "IMAGE_COMPLEXITY_UNSUPPORTED" ||
			view.RefundedCost != view.TotalCost || view.ActualCost != 0 {
			t.Fatalf("disabled planning level should fail and refund: %+v, %v", view, err)
		}
		if after := creditBalance(t, f, actor.ID); after.Total != beforeQueued.Total {
			t.Fatalf("queued task refund was not applied: before=%d after=%d", beforeQueued.Total, after.Total)
		}
	})
}

func TestImageComplexityInput(t *testing.T) {
	for _, input := range []string{`null`, `""`, `"auto"`, `"xhigh"`, `12`} {
		var complexity validation.ImageComplexity
		if err := json.Unmarshal([]byte(input), &complexity); err == nil {
			t.Errorf("accepted invalid explicit planning level: %s", input)
		}
	}
}
