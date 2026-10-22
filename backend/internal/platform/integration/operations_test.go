//go:build integration

package integration_test

import (
	"context"
	"io"
	"log/slog"
	"net/netip"
	"net/url"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/auth"
	"github.com/xinghenWink/Lumi/backend/internal/jobs"
	"github.com/xinghenWink/Lumi/backend/internal/operations"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

func (m *captureMailer) SendReset(_ context.Context, email, link, _ string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.codes[email+":reset"] = link
	return nil
}
func TestM6PasswordResetIsSingleUseAndRevokesSessions(t *testing.T) {
	f := newAccountFixture(t)
	admin := creditActor(t, f)
	member := creditMember(t, f, admin, 0)
	client := auth.Client{IP: netip.MustParseAddr("127.0.0.1"), UserAgent: "M6 fixture"}
	login, err := f.services.Auth.Login(f.ctx, auth.LoginInput{Email: member.Email, Password: "Integration-password-1"}, client)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.services.Auth.ForgotPassword(f.ctx, auth.CodeInput{Email: member.Email, Locale: "en"}, client, "https://lumi.test"); err != nil {
		t.Fatal(err)
	}
	link, err := url.Parse(f.sender.code(member.Email + ":reset"))
	if err != nil {
		t.Fatal(err)
	}
	values, err := url.ParseQuery(link.Fragment)
	if err != nil {
		t.Fatal(err)
	}
	token := values.Get("token")
	if len(token) != 43 || link.RawQuery != "" {
		t.Fatal("reset token was not placed in fragment")
	}
	var success atomic.Int32
	var wait sync.WaitGroup
	for i := 0; i < 2; i++ {
		wait.Go(func() {
			err := f.services.Auth.ResetPassword(f.ctx, auth.ResetInput{Token: token, Password: "Updated-password-2"}, client)
			if err == nil {
				success.Add(1)
			} else if creditCode(err) != "RESET_INVALID" {
				t.Errorf("reset error: %v", err)
			}
		})
	}
	wait.Wait()
	if success.Load() != 1 {
		t.Fatalf("successful resets=%d", success.Load())
	}
	if _, err := f.services.Auth.Authenticate(f.ctx, login.AccessToken, client.IP); creditCode(err) != "AUTH_REQUIRED" {
		t.Fatalf("old session survived: %v", err)
	}
	if _, err := f.services.Auth.Login(f.ctx, auth.LoginInput{Email: member.Email, Password: "Updated-password-2"}, client); err != nil {
		t.Fatal(err)
	}
}
func TestM6PreferencesDevicesBatchGrantsAndSelfDeletion(t *testing.T) {
	f := newAccountFixture(t)
	admin := creditActor(t, f)
	member := creditMember(t, f, admin, 10)
	second := creditMember(t, f, admin, 10)
	row, err := query.New(f.pool).GetUser(f.ctx, member.ID)
	if err != nil {
		t.Fatal(err)
	}
	actor := user.Actor{ID: member.ID, TokenVersion: row.TokenVersion, IP: admin.IP}
	pref := user.Preferences{Theme: "dark", Instructions: "Be concise", ImageQuality: "high", ImageRatio: "16:9", ImageCount: 3}
	saved, err := f.services.Users.SavePreferences(f.ctx, actor, pref)
	if err != nil || saved != pref {
		t.Fatalf("preferences=%+v error=%v", saved, err)
	}
	client := auth.Client{IP: admin.IP, UserAgent: "Firefox/M6"}
	first, err := f.services.Auth.Login(f.ctx, auth.LoginInput{Email: member.Email, Password: "Integration-password-1"}, client)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.services.Auth.Login(f.ctx, auth.LoginInput{Email: member.Email, Password: "Integration-password-1"}, client); err != nil {
		t.Fatal(err)
	}
	devices, err := f.services.Users.Devices(f.ctx, member.ID)
	if err != nil || len(devices) != 2 {
		t.Fatalf("devices=%+v error=%v", devices, err)
	}
	if err := f.services.Users.RevokeDevices(f.ctx, actor, member.ID, &devices[0].ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := f.services.Users.Devices(f.ctx, second.ID); err != nil {
		t.Fatal(err)
	}
	if err := f.services.Users.RevokeDevices(f.ctx, actor, second.ID, nil, false); creditCode(err) != "FORBIDDEN" {
		t.Fatalf("revoked another user: %v", err)
	}
	before := creditBalance(t, f, member.ID)
	key := uuid.NewString()
	ids := []uuid.UUID{member.ID, second.ID}
	for i := 0; i < 2; i++ {
		if err := f.services.Credits.BatchGrant(f.ctx, admin, ids, key, 7, "batch fixture"); err != nil {
			t.Fatal(err)
		}
	}
	after := creditBalance(t, f, member.ID)
	if after.PermanentBalance-before.PermanentBalance != 7 {
		t.Fatal("batch replay granted twice")
	}
	if err := f.services.Users.Batch(f.ctx, admin, []uuid.UUID{member.ID, admin.ID}, "disable"); creditCode(err) != "CANNOT_MODIFY_SELF" {
		t.Fatalf("batch bypassed self protection: %v", err)
	}
	current, err := query.New(f.pool).GetUser(f.ctx, member.ID)
	if err != nil || current.Status != "active" {
		t.Fatal("rejected batch partially committed")
	}
	if err := f.services.Users.DeleteSelf(f.ctx, actor, member.Email, "Integration-password-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.services.Auth.Authenticate(f.ctx, first.AccessToken, admin.IP); creditCode(err) != "AUTH_REQUIRED" {
		t.Fatal("deleted account token survived")
	}
	if _, err := f.pool.Exec(f.ctx, "UPDATE users SET purge_after=now()-interval '1 second' WHERE id=$1", member.ID); err != nil {
		t.Fatal(err)
	}
	worker := jobs.New(f.pool, f.cache, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	if err := worker.Tick(f.ctx); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := f.pool.QueryRow(f.ctx, "SELECT count(*) FROM users WHERE id=$1", member.ID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("self-deleted account not purged: %v", err)
	}
}
func TestM6AnnouncementsDashboardAndReconciliation(t *testing.T) {
	f := newAccountFixture(t)
	actor := creditActor(t, f)
	service := operations.New(f.pool)
	now := time.Now().UTC().Add(-time.Minute)
	visible, err := service.SaveAnnouncement(f.ctx, actor, uuid.Nil, operations.Announcement{Content: "Visible **announcement**", StartsAt: now, Enabled: true}, false)
	if err != nil {
		t.Fatal(err)
	}
	end := now.Add(10 * time.Second)
	if _, err := service.SaveAnnouncement(f.ctx, actor, uuid.Nil, operations.Announcement{Content: "Expired", StartsAt: now, EndsAt: &end, Enabled: true}, false); err != nil {
		t.Fatal(err)
	}
	page, err := service.Announcements(f.ctx, true, "", 20)
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != visible.ID {
		t.Fatalf("active announcements=%+v error=%v", page, err)
	}
	if _, err := service.SaveAnnouncement(f.ctx, actor, visible.ID, operations.Announcement{Content: "stale", StartsAt: now, Enabled: true, Version: 0}, false); creditCode(err) != "CONFIGURATION_CONFLICT" {
		t.Fatalf("stale announcement overwrite: %v", err)
	}
	dashboard, err := service.Dashboard(f.ctx, 7)
	if err != nil || len(dashboard.Days) != 7 || dashboard.Users < 1 {
		t.Fatalf("dashboard=%+v error=%v", dashboard, err)
	}
	member := creditMember(t, f, actor, 10)
	if _, err := f.pool.Exec(f.ctx, "UPDATE credit_accounts SET permanent_balance=permanent_balance+1 WHERE user_id=$1", member.ID); err != nil {
		t.Fatal(err)
	}
	worker := jobs.New(f.pool, f.cache, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	for i := 0; i < 2; i++ {
		if err := worker.Tick(f.ctx); err != nil {
			t.Fatal(err)
		}
	}
	var alerts int
	if err := f.pool.QueryRow(f.ctx, "SELECT count(*) FROM audit_logs WHERE action='credits.reconciliation_alert' AND target_id=$1", member.ID).Scan(&alerts); err != nil || alerts != 1 {
		t.Fatalf("alerts=%d error=%v", alerts, err)
	}
	run, err := query.New(f.pool).GetJobRun(f.ctx, "reconciliation")
	if err != nil || run.Affected != 1 {
		t.Fatalf("reconciliation=%+v error=%v", run, err)
	}
}
