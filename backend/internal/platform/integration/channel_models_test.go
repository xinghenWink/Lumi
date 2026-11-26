//go:build integration

package integration_test

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pressly/goose/v3"
	"github.com/xinghenWink/Lumi/backend/internal/catalog"
	"github.com/xinghenWink/Lumi/backend/internal/images"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/migrations"
)

func TestChannelModelManagement(t *testing.T) {
	legacyID := uuid.New()
	endpoint := "https://fixture.example.test/v1"
	f := accountFixtureWithMigrations(t, func(ctx context.Context, pool *pgxpool.Pool) error {
		if err := withUpgradeProvider(ctx, pool, func(p *goose.Provider) error {
			_, err := p.UpTo(ctx, 25)
			return err
		}); err != nil {
			return err
		}
		if _, err := pool.Exec(ctx, `INSERT INTO upstreams (id,name,base_url,api_key_enc,enabled)
			VALUES ($1,'Legacy internal channel',$2,'',false)`, legacyID, endpoint); err != nil {
			return fmt.Errorf("seed legacy channel: %w", err)
		}
		return migrations.Up(ctx, pool)
	})
	svc, q := f.services.Catalog, query.New(f.pool)
	admin := creditActor(t, f)
	member := creditMember(t, f, admin, 50)
	actor := canvasActor(t, f, member)
	client, memberClient := f.client(t), f.client(t)
	token := f.login(t, client, f.adminEmail, f.adminPassword).AccessToken
	memberToken := f.login(t, memberClient, member.Email, "Integration-password-1").AccessToken

	upstreams := "/api/v1/admin/upstreams"
	legacy := decodeReply[catalog.Page[catalog.Channel]](t, f.call(t, client, http.MethodGet, upstreams, token, nil))
	if len(legacy.Items) != 1 || legacy.Items[0].ID != legacyID || legacy.Items[0].Name != "Legacy internal channel" || legacy.Items[0].DisplayName != "" {
		t.Fatalf("legacy channel changed during migration: %+v", legacy.Items)
	}
	key := "catalog-fixture-key"
	channelInput := catalog.ChannelInput{
		Name: "Private primary name", DisplayName: new("  公开渠道  "), BaseURL: endpoint, APIKey: &key,
		TimeoutChatS: 5, TimeoutImageS: 5, Enabled: true, Priority: 10, Weight: 1, EditFormat: "multipart",
	}
	created := f.call(t, client, http.MethodPost, upstreams, token, channelInput)
	expectStatus(t, created, http.StatusCreated)
	primary := decodeReply[catalog.Channel](t, created)
	if primary.DisplayName != "公开渠道" {
		t.Fatalf("display name was not trimmed: %q", primary.DisplayName)
	}
	found := decodeReply[catalog.Page[catalog.Channel]](t, f.call(t, client, http.MethodGet, upstreams+"?search="+url.QueryEscape(primary.DisplayName), token, nil))
	if len(found.Items) != 1 || found.Items[0].ID != primary.ID {
		t.Fatalf("display-name search did not identify the primary channel: %+v", found.Items)
	}
	channelInput.DisplayName = nil
	channelInput.Name = legacy.Items[0].Name
	channelInput.Priority = 0
	channelInput.Version = legacy.Items[0].Version
	backup, err := svc.SaveChannel(f.ctx, admin, legacyID, channelInput)
	if err != nil {
		t.Fatal(err)
	}
	route := func(id uuid.UUID, name string, priority int32, enabled bool) catalog.RouteInput {
		return catalog.RouteInput{UpstreamID: id, UpstreamModelName: name, Priority: priority, Weight: 1, Enabled: enabled}
	}
	model := func(name string, enabled, isDefault bool, routes ...catalog.RouteInput) catalog.Model {
		t.Helper()
		result, err := svc.SaveModel(f.ctx, admin, uuid.Nil, catalog.ModelInput{
			DisplayName: name, Type: "image", Enabled: enabled, IsDefault: isDefault, Routes: routes,
			Capabilities: catalog.Capabilities{Qualities: []string{"low"}, Sizes: []string{"1024x1024"}, MaxN: 1, ResponseFormat: "b64_json"},
		})
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	first := model("Exclusive default", true, true, route(primary.ID, "primary-first", 0, true), route(primary.ID, "primary-unused", 1, false))
	second := model("Exclusive inactive", false, false, route(primary.ID, "primary-second", 0, true))
	shared := model("Shared model", true, false, route(primary.ID, "primary-shared", 0, true), route(primary.ID, "primary-secondary", 2, true), route(backup.ID, "backup-shared", 1, true))
	other := model("Other channel", true, false, route(backup.ID, "backup-only", 0, true))

	publicName := func(id uuid.UUID, want string) {
		t.Helper()
		response := f.call(t, memberClient, http.MethodGet, "/api/v1/models?type=image", memberToken, nil)
		expectStatus(t, response, http.StatusOK)
		for _, private := range []string{primary.Name, primary.ID.String(), key, endpoint, "primary-shared"} {
			if strings.Contains(string(response.body), private) {
				t.Fatalf("public catalog exposes %q", private)
			}
		}
		listing := decodeReply[catalog.Page[catalog.PublicModel]](t, response)
		index := slices.IndexFunc(listing.Items, func(item catalog.PublicModel) bool { return item.ID == id })
		if index < 0 || listing.Items[index].DisplayName != want {
			t.Fatalf("public name did not match %q: %+v", want, listing.Items)
		}
	}
	publicName(shared.ID, "Shared model（公开渠道）")
	publicName(other.ID, "Other channel")
	if _, err := f.pool.Exec(f.ctx, "UPDATE upstreams SET open_until=now()+interval '1 minute' WHERE id=$1", primary.ID); err != nil {
		t.Fatal(err)
	}
	publicName(shared.ID, "Shared model（公开渠道）")
	conversation, err := f.services.Images.CreateConversation(f.ctx, actor, uuid.New(), shared.ID)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := f.services.Images.Submit(f.ctx, actor, uuid.NewString(), images.Input{
		ConversationID: conversation.ID, ModelID: shared.ID, Quality: "low", Prompt: "Snapshot", Size: "1024x1024", Count: 1,
	})
	if err != nil || snapshot.ModelName != "Shared model（公开渠道）" {
		t.Fatalf("submission used unexpected model name: %q, %v", snapshot.ModelName, err)
	}

	channelInput.Name = primary.Name
	channelInput.Version = primary.Version
	channelInput.APIKey = nil
	primaryPath := upstreams + "/" + primary.ID.String()
	updated := f.call(t, client, http.MethodPut, primaryPath, token, channelInput)
	expectStatus(t, updated, http.StatusOK)
	preserved := decodeReply[catalog.Channel](t, updated)
	if preserved.DisplayName != primary.DisplayName {
		t.Fatalf("old client erased the saved display name: %+v", preserved)
	}
	channelInput.Version = preserved.Version
	for _, invalid := range []string{strings.Repeat("图", 81), "invalid\nname"} {
		channelInput.DisplayName = &invalid
		expectStatus(t, f.call(t, client, http.MethodPut, primaryPath, token, channelInput), http.StatusBadRequest)
	}
	channelInput.DisplayName = new("")
	expectStatus(t, f.call(t, client, http.MethodPut, primaryPath, token, channelInput), http.StatusOK)
	publicName(shared.ID, "Shared model")
	channelInput.Name = backup.Name
	channelInput.Version = backup.Version
	channelInput.Priority = backup.Priority
	channelInput.DisplayName = new("备用")
	expectStatus(t, f.call(t, client, http.MethodPut, upstreams+"/"+backup.ID.String(), token, channelInput), http.StatusOK)
	publicName(shared.ID, "Shared model")
	publicName(other.ID, "Other channel（备用）")

	modelsPath := "/api/v1/admin/models?limit=1&type=image&upstream_id="
	page := decodeReply[catalog.Page[catalog.Model]](t, f.call(t, client, http.MethodGet, modelsPath+primary.ID.String(), token, nil))
	if len(page.Items) != 1 || page.Items[0].DisplayName != shared.DisplayName || page.NextCursor == "" {
		t.Fatalf("unexpected first page: %+v", page)
	}
	expectStatus(t, f.call(t, client, http.MethodGet, modelsPath+backup.ID.String()+"&cursor="+url.QueryEscape(page.NextCursor), token, nil), http.StatusBadRequest)
	expectStatus(t, f.call(t, client, http.MethodGet, modelsPath+"invalid", token, nil), http.StatusBadRequest)

	batchPath := primaryPath + "/models/batch"
	input := catalog.ChannelModelBatchInput{Action: "disable"}
	expectStatus(t, f.call(t, memberClient, http.MethodPost, batchPath, memberToken, input), http.StatusForbidden)
	expectStatus(t, f.call(t, client, http.MethodPost, batchPath, token, catalog.ChannelModelBatchInput{Action: "invalid"}), http.StatusBadRequest)
	expectStatus(t, f.call(t, client, http.MethodPost, upstreams+"/"+uuid.NewString()+"/models/batch", token, input), http.StatusNotFound)
	batch := func(action string, exclusive, shared int) {
		t.Helper()
		response := f.call(t, client, http.MethodPost, batchPath, token, catalog.ChannelModelBatchInput{Action: action})
		expectStatus(t, response, http.StatusOK)
		result := decodeReply[catalog.ChannelModelBatchResult](t, response)
		if result.AffectedExclusiveModels != exclusive || result.AffectedSharedModels != shared {
			t.Fatalf("batch %s returned unexpected counts: %+v", action, result)
		}
	}
	state := func(id uuid.UUID, enabled, isDefault bool, version int64) {
		t.Helper()
		row, err := q.GetPlatformModel(f.ctx, id)
		if err != nil || row.Enabled != enabled || row.IsDefault != isDefault || row.Version != version {
			t.Fatalf("unexpected model state: %+v, %v", row, err)
		}
	}
	batch("disable", 1, 1)
	state(first.ID, false, false, first.Version+1)
	state(second.ID, false, false, second.Version)
	state(shared.ID, true, false, shared.Version+1)
	state(other.ID, true, false, other.Version)
	publicName(shared.ID, "Shared model（备用）")
	batch("disable", 0, 0)
	if _, err := svc.SaveModel(f.ctx, admin, shared.ID, editableModel(shared)); creditCode(err) != "CONFIGURATION_CONFLICT" {
		t.Fatalf("batch accepted a stale edit: %v", err)
	}
	batch("enable", 2, 1)
	state(first.ID, true, false, first.Version+2)
	state(second.ID, true, false, second.Version+1)
	state(shared.ID, true, false, shared.Version+2)
	routes, err := q.ListModelRoutes(f.ctx, first.ID)
	if err != nil || len(routes) != 2 || !routes[0].Enabled || routes[1].Enabled {
		t.Fatalf("batch overwrote exclusive route flags: %+v, %v", routes, err)
	}
	for _, id := range []uuid.UUID{first.ID, second.ID, shared.ID} {
		if _, err := f.pool.Exec(f.ctx, "INSERT INTO pricing_rules (id,model_id,operation,quality,credits_per_image) VALUES ($1,$2,'generate','low',3)", uuid.New(), id); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.pool.Exec(f.ctx, `CREATE FUNCTION reject_channel_batch() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN RAISE EXCEPTION 'injected batch audit failure'; END; $$;
		CREATE TRIGGER reject_channel_batch BEFORE INSERT ON audit_logs FOR EACH ROW
		WHEN (NEW.action = 'model.channel_batch') EXECUTE FUNCTION reject_channel_batch()`); err != nil {
		t.Fatal(err)
	}
	priceCount := func(want int) {
		t.Helper()
		var count int
		if err := f.pool.QueryRow(f.ctx, "SELECT count(*) FROM pricing_rules WHERE model_id=ANY($1::uuid[])", []uuid.UUID{first.ID, second.ID, shared.ID}).Scan(&count); err != nil || count != want {
			t.Fatalf("price overrides = %d, want %d, error = %v", count, want, err)
		}
	}
	expectStatus(t, f.call(t, client, http.MethodPost, batchPath, token, catalog.ChannelModelBatchInput{Action: "delete"}), http.StatusInternalServerError)
	state(first.ID, true, false, first.Version+2)
	state(second.ID, true, false, second.Version+1)
	state(shared.ID, true, false, shared.Version+2)
	priceCount(3)
	if _, err := f.pool.Exec(f.ctx, "DROP TRIGGER reject_channel_batch ON audit_logs; DROP FUNCTION reject_channel_batch()"); err != nil {
		t.Fatal(err)
	}
	batch("delete", 2, 1)
	state(shared.ID, true, false, shared.Version+3)
	routes, err = q.ListModelRoutes(f.ctx, shared.ID)
	if err != nil || len(routes) != 1 || routes[0].UpstreamID != backup.ID || !routes[0].Enabled {
		t.Fatalf("batch did not preserve the other channel route: %+v, %v", routes, err)
	}
	priceCount(1)
	batch("delete", 0, 0)
	remaining, err := svc.Models(f.ctx, catalog.Filter{Limit: 100})
	if err != nil || len(remaining.Items) != 2 {
		t.Fatalf("unexpected remaining models: %+v, %v", remaining, err)
	}
	stored, err := f.services.Images.Get(f.ctx, actor, snapshot.ID, false)
	if err != nil || stored.ModelName != snapshot.ModelName {
		t.Fatalf("saved display name changed after channel edits: %q, %v", stored.ModelName, err)
	}
}
