//go:build integration

package integration_test

import (
	"bytes"
	"net/http"
	"net/url"
	"testing"

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

func TestAdminListsShowCurrentUserIdentity(t *testing.T) {
	f := newAccountFixture(t)
	client := f.client(t)
	admin := f.login(t, client, f.adminEmail, f.adminPassword)
	actor := creditActor(t, f)
	const memberPassword = "Integration-password-1"
	createMember := func(email, nickname string) user.Profile {
		t.Helper()
		member, err := f.services.Users.Create(f.ctx, actor, user.CreateInput{
			Email: email, Password: memberPassword, Nickname: nickname, Role: "user",
		})
		if err != nil {
			t.Fatal(err)
		}
		return member
	}
	first := createMember("first@lumi.test", "First member")
	second := createMember("second@lumi.test", "Second member")
	firstChat, firstTask := seedAdminListRecords(t, f, first.ID)
	secondChat, secondTask := seedAdminListRecords(t, f, second.ID)
	member := f.login(t, f.client(t), first.Email, memberPassword)

	type row struct {
		ID             uuid.UUID `json:"id"`
		UserID         uuid.UUID `json:"user_id"`
		UserNickname   *string   `json:"user_nickname"`
		UserEmail      *string   `json:"user_email"`
		ContentVisible bool      `json:"content_visible"`
		Prompt         string    `json:"prompt"`
	}
	type page struct {
		Items      []row  `json:"items"`
		NextCursor string `json:"next_cursor"`
	}
	const chats = "/api/v1/admin/conversations"
	const tasks = "/api/v1/admin/image-tasks"
	lists := []struct {
		admin, public     string
		firstID, secondID uuid.UUID
	}{
		{chats, "/api/v1/conversations", firstChat, secondChat},
		{tasks, "/api/v1/image-tasks", firstTask, secondTask},
	}
	readList := func(path string, params url.Values) page {
		t.Helper()
		response := f.call(t, client, http.MethodGet, path+"?"+params.Encode(), admin.AccessToken, nil)
		expectStatus(t, response, http.StatusOK)
		return decodeReply[page](t, response)
	}
	assertOwner := func(result page, id uuid.UUID, owner user.Profile) {
		t.Helper()
		if len(result.Items) != 1 {
			t.Fatalf("expected one row, got %d", len(result.Items))
		}
		item := result.Items[0]
		if item.ID != id || item.UserID != owner.ID || item.UserNickname == nil || *item.UserNickname != owner.Nickname || item.UserEmail == nil || *item.UserEmail != owner.Email {
			t.Fatalf("unexpected identity metadata for row %s and user %s", id, owner.ID)
		}
		if item.ContentVisible || item.Prompt != "" {
			t.Fatal("image prompt must remain hidden with content access disabled")
		}
	}
	assertNoIdentity := func(response reply) {
		t.Helper()
		expectStatus(t, response, http.StatusOK)
		if bytes.Contains(response.body, []byte(`"user_nickname"`)) || bytes.Contains(response.body, []byte(`"user_email"`)) {
			t.Fatal("response exposed admin list identity fields")
		}
	}
	for _, list := range lists {
		expectStatus(t, f.call(t, client, http.MethodGet, list.admin, member.AccessToken, nil), http.StatusForbidden)
		assertNoIdentity(f.call(t, client, http.MethodGet, list.public, member.AccessToken, nil))

		both := readList(list.admin, nil)
		if len(both.Items) != 2 {
			t.Fatalf("expected two rows in %s, got %d", list.admin, len(both.Items))
		}
		assertOwner(page{Items: both.Items[:1]}, list.secondID, second)
		assertOwner(page{Items: both.Items[1:]}, list.firstID, first)
		newest := readList(list.admin, url.Values{"limit": {"1"}})
		assertOwner(newest, list.secondID, second)
		if newest.NextCursor == "" {
			t.Fatal("missing second page cursor")
		}
		assertOwner(readList(list.admin, url.Values{"limit": {"1"}, "cursor": {newest.NextCursor}}), list.firstID, first)
		assertOwner(readList(list.admin, url.Values{"user_id": {first.ID.String()}}), list.firstID, first)
	}
	assertNoIdentity(f.call(t, client, http.MethodGet, tasks+"/"+firstTask.String(), admin.AccessToken, nil))
	expectStatus(t, f.call(t, client, http.MethodGet, chats+"/"+firstChat.String()+"/messages?user_id="+first.ID.String(), admin.AccessToken, nil), http.StatusForbidden)

	nickname, email := "Updated member", "updated@lumi.test"
	updated, err := f.services.Users.Update(f.ctx, actor, first.ID, user.UpdateInput{Nickname: &nickname, Email: &email})
	if err != nil {
		t.Fatal(err)
	}
	for _, list := range lists {
		assertOwner(readList(list.admin, url.Values{"user_id": {first.ID.String()}}), list.firstID, updated)
	}
	if err := f.services.Users.Delete(f.ctx, actor, first.ID, updated.Email); err != nil {
		t.Fatal(err)
	}
	for _, list := range lists {
		result := readList(list.admin, url.Values{"user_id": {first.ID.String()}})
		if len(result.Items) != 1 || result.Items[0].ID != list.firstID || result.Items[0].UserID != first.ID || result.Items[0].UserNickname != nil || result.Items[0].UserEmail != nil {
			t.Fatalf("expected retained %s row with no deleted account identity", list.admin)
		}
	}
}

func seedAdminListRecords(t *testing.T, f *fixture, owner uuid.UUID) (uuid.UUID, uuid.UUID) {
	t.Helper()
	chatID, taskID, chargeID := uuid.New(), uuid.New(), uuid.New()
	if err := query.New(f.pool).CreateConversation(f.ctx, query.CreateConversationParams{ID: chatID, UserID: owner}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `
		INSERT INTO credit_charges(id,user_id,reference_id,operation,quality,size,image_count,unit_price,total_cost,daily_charged,permanent_charged,daily_reset_on,settled)
		VALUES($1,$2,$3,'generate','low','1024x1024',1,0,0,0,0,current_date,true)`, chargeID, owner, taskID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `
		INSERT INTO image_tasks(id,user_id,conversation_id,message_id,user_message_id,model_id,model_name,operation,prompt,params,quality,
			size,image_count,charge_id,unit_price,total_cost,status,idempotency_key,request_hash,split_requests,timeout_seconds,queue_deadline)
		VALUES($1,$2,$3,$4,$5,$6,'Fixture model','generate','private prompt','{}','low','1024x1024',1,$7,0,0,'failed',$1::uuid::text,'fixture',false,30,now())`,
		taskID, owner, uuid.New(), uuid.New(), uuid.New(), uuid.New(), chargeID); err != nil {
		t.Fatal(err)
	}
	return chatID, taskID
}
