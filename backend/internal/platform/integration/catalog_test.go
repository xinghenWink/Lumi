//go:build integration

package integration_test

import (
	"encoding/json"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/catalog"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/upstream/mock"
)

func editableModel(model catalog.Model) catalog.ModelInput {
	routes := make([]catalog.RouteInput, 0, len(model.Routes))
	for _, route := range model.Routes {
		routes = append(routes, route.RouteInput)
	}
	return catalog.ModelInput{Version: model.Version, DisplayName: model.DisplayName, Type: model.Type, Description: model.Description, Icon: model.Icon, SortOrder: model.SortOrder, Enabled: model.Enabled, IsDefault: model.IsDefault, Capabilities: model.Capabilities, Routes: routes}
}
func TestCatalogTransactionsDiscoveryAndIsolation(t *testing.T) {
	f := newAccountFixture(t)
	actor := creditActor(t, f)
	service := f.services.Catalog
	key := "integration-upstream-only-key"
	server := mock.New(mock.Configuration{APIKey: key, Models: []string{"wire-private-text", "wire-private-image"}})
	defer server.Close()
	input := catalog.ChannelInput{Name: "Test channel", BaseURL: server.URL + "/v1", APIKey: &key, TimeoutChatS: 2, TimeoutImageS: 2, Enabled: true, Weight: 1, EditFormat: "multipart"}
	channel, err := service.SaveChannel(f.ctx, actor, uuid.Nil, input)
	if err != nil {
		t.Fatal(err)
	}
	row, err := query.New(f.pool).GetUpstream(f.ctx, channel.ID)
	if err != nil || row.ApiKeyEnc == key || strings.Contains(row.ApiKeyEnc, key) {
		t.Fatalf("channel credentials were not encrypted: %v", err)
	}
	decrypted, err := f.vault.Decrypt(row.ApiKeyEnc, "upstream:"+channel.ID.String())
	if err != nil || decrypted != key {
		t.Fatalf("channel secret cannot be recovered: %v", err)
	}
	input.Version = channel.Version
	input.APIKey = nil
	input.Note = "Updated without replacing the key"
	channel, err = service.SaveChannel(f.ctx, actor, channel.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SaveChannel(f.ctx, actor, channel.ID, input); creditCode(err) != "CONFIGURATION_CONFLICT" {
		t.Fatalf("stale channel update accepted: %v", err)
	}
	connection, err := service.Test(f.ctx, actor, channel.ID)
	if err != nil || !connection.Success || connection.ModelCount != 2 {
		t.Fatalf("connection result=%+v error=%v", connection, err)
	}
	discovery, err := service.Discover(f.ctx, actor, channel.ID)
	if err != nil || len(discovery.Models) != 2 {
		t.Fatalf("discovery=%+v error=%v", discovery, err)
	}
	capabilities := catalog.Capabilities{Stream: true, MaxContextTokens: 32768}
	importInput := catalog.ImportInput{Version: channel.Version, Models: []catalog.ImportModel{{RemoteID: "wire-private-text", DisplayName: "Lumi conversation", Type: "chat", Capabilities: capabilities}}}
	imported, err := service.Import(f.ctx, actor, channel.ID, importInput)
	if err != nil || len(imported) != 1 || imported[0].Enabled {
		t.Fatalf("import=%+v error=%v", imported, err)
	}
	repeated, err := service.Import(f.ctx, actor, channel.ID, importInput)
	if err != nil || len(repeated) != 1 || repeated[0].ID != imported[0].ID {
		t.Fatalf("repeated import duplicated a model: %v", err)
	}
	if public, err := service.Public(f.ctx, "chat"); err != nil || len(public) != 0 {
		t.Fatalf("unreviewed model published: %v", err)
	}
	firstInput := editableModel(imported[0])
	firstInput.Enabled = true
	first, err := service.SaveModel(f.ctx, actor, imported[0].ID, firstInput)
	if err != nil {
		t.Fatal(err)
	}
	secondInput := firstInput
	secondInput.Version = 0
	secondInput.DisplayName = "Another platform conversation"
	second, err := service.SaveModel(f.ctx, actor, uuid.Nil, secondInput)
	if err != nil {
		t.Fatal(err)
	}
	t.Run("concurrent defaults remain unique", func(t *testing.T) {
		var group sync.WaitGroup
		failures := make(chan error, 2)
		for _, model := range []catalog.Model{first, second} {
			group.Go(func() {
				proposal := editableModel(model)
				proposal.IsDefault = true
				_, err := service.SaveModel(f.ctx, actor, model.ID, proposal)
				failures <- err
			})
		}
		group.Wait()
		close(failures)
		for err := range failures {
			if err != nil {
				t.Fatal(err)
			}
		}
		var count int
		if err := f.pool.QueryRow(f.ctx, "SELECT count(*) FROM models WHERE type='chat' AND is_default").Scan(&count); err != nil || count != 1 {
			t.Fatalf("default count=%d error=%v", count, err)
		}
	})
	public, err := service.Public(f.ctx, "chat")
	if err != nil || len(public) != 2 {
		t.Fatalf("public models=%+v error=%v", public, err)
	}
	encoded, err := json.Marshal(public)
	if err != nil {
		t.Fatal(err)
	}
	for _, private := range []string{key, "wire-private", "upstream_id", "base_url", "routes", server.URL, channel.ID.String()} {
		if strings.Contains(string(encoded), private) {
			t.Fatalf("public model metadata leaked %q", private)
		}
	}
	member := creditMember(t, f, actor, 0)
	normalClient := f.client(t)
	normal := f.login(t, normalClient, member.Email, "Integration-password-1")
	expectStatus(t, f.call(t, normalClient, "GET", "/api/v1/models?type=chat", normal.AccessToken, nil), 200)
	expectStatus(t, f.call(t, normalClient, "GET", "/api/v1/admin/upstreams", normal.AccessToken, nil), 403)
	expectStatus(t, f.call(t, normalClient, "POST", "/api/v1/admin/models", normal.AccessToken, firstInput), 403)
	adminClient := f.client(t)
	admin := f.login(t, adminClient, f.adminEmail, f.adminPassword)
	tested := f.call(t, adminClient, "POST", "/api/v1/admin/upstreams/"+channel.ID.String()+"/test", admin.AccessToken, nil)
	expectStatus(t, tested, 200)
	var requestCount int
	if err := f.pool.QueryRow(f.ctx, "SELECT count(*) FROM upstream_calls WHERE request_id<>''").Scan(&requestCount); err != nil || requestCount == 0 {
		t.Fatalf("HTTP call did not preserve request ID: %v", err)
	}
	var snapshots string
	if err := f.pool.QueryRow(f.ctx, "SELECT coalesce(string_agg(before::text||after::text,' '),'') FROM audit_logs").Scan(&snapshots); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(snapshots, key) || strings.Contains(snapshots, row.ApiKeyEnc) {
		t.Fatal("audit exposed channel key material")
	}
	t.Run("audit failure rolls back configuration", func(t *testing.T) {
		_, err := f.pool.Exec(f.ctx, "CREATE FUNCTION reject_catalog_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END; $$; CREATE TRIGGER reject_catalog_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_catalog_audit()")
		if err != nil {
			t.Fatal(err)
		}
		defer func() {
			if _, err := f.pool.Exec(f.ctx, "DROP TRIGGER reject_catalog_audit ON audit_logs; DROP FUNCTION reject_catalog_audit()"); err != nil {
				t.Error(err)
			}
		}()
		proposal := input
		proposal.Version = channel.Version
		proposal.Name = "Must roll back"
		if _, err := service.SaveChannel(f.ctx, actor, channel.ID, proposal); err == nil {
			t.Fatal("configuration ignored audit failure")
		}
		current, err := query.New(f.pool).GetUpstream(f.ctx, channel.ID)
		if err != nil || current.Name != channel.Name {
			t.Fatal("failed audited update was committed")
		}
	})
	if _, err := f.pool.Exec(f.ctx, "UPDATE upstream_calls SET created_at=now()-interval '31 days'"); err != nil {
		t.Fatal(err)
	}
	if count, err := service.PurgeCalls(f.ctx); err != nil || count == 0 {
		t.Fatalf("old call retention count=%d error=%v", count, err)
	}
	if err := service.DeleteChannel(f.ctx, actor, channel.ID); err != nil {
		t.Fatal(err)
	}
	if public, err := service.Public(f.ctx, "chat"); err != nil || len(public) != 0 {
		t.Fatalf("orphan model remained publicly available: %v", err)
	}
	if err := service.DeleteModel(f.ctx, actor, first.ID); err != nil {
		t.Fatal(err)
	}
}
