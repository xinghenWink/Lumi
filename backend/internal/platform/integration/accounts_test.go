//go:build integration

package integration_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/auth"
	"github.com/xinghenWink/Lumi/backend/internal/catalog"
	"github.com/xinghenWink/Lumi/backend/internal/chat"
	"github.com/xinghenWink/Lumi/backend/internal/credits"
	"github.com/xinghenWink/Lumi/backend/internal/http/account"
	"github.com/xinghenWink/Lumi/backend/internal/http/handler"
	"github.com/xinghenWink/Lumi/backend/internal/http/router"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/password"
	platformredis "github.com/xinghenWink/Lumi/backend/internal/platform/redis"
	"github.com/xinghenWink/Lumi/backend/internal/platform/secrets"
	"github.com/xinghenWink/Lumi/backend/internal/settings"
	"github.com/xinghenWink/Lumi/backend/internal/upstream"
	"github.com/xinghenWink/Lumi/backend/internal/user"
	"github.com/xinghenWink/Lumi/backend/migrations"
)

type captureMailer struct {
	mu    sync.Mutex
	codes map[string]string
}

func (m *captureMailer) SendCode(_ context.Context, email, code, _ string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.codes[strings.ToLower(email)] = code
	return nil
}
func (m *captureMailer) code(email string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.codes[strings.ToLower(email)]
}

type fixture struct {
	vault                     *secrets.Vault
	ctx                       context.Context
	pool                      *pgxpool.Pool
	cache                     *platformredis.Client
	services                  *account.Services
	sender                    *captureMailer
	server                    *httptest.Server
	adminEmail, adminPassword string
}
type reply struct {
	status  int
	body    []byte
	header  http.Header
	cookies []*http.Cookie
}

func newAccountFixture(t *testing.T) *fixture {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Minute)
	t.Cleanup(cancel)
	postgres, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{ContainerRequest: testcontainers.ContainerRequest{Image: "postgres:16-alpine", ExposedPorts: []string{"5432/tcp"}, Env: map[string]string{"POSTGRES_USER": "lumi", "POSTGRES_PASSWORD": "integration-only", "POSTGRES_DB": "lumi"}, WaitingFor: wait.ForLog("database system is ready to accept connections").WithOccurrence(2)}, Started: true})
	testcontainers.CleanupContainer(t, postgres)
	if err != nil {
		t.Fatalf("start authentication PostgreSQL: %v", err)
	}
	address, err := postgres.PortEndpoint(ctx, "5432/tcp", "")
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.Open(ctx, "postgres://lumi:integration-only@"+address+"/lumi?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := migrations.Up(ctx, pool); err != nil {
		t.Fatalf("account migrations: %v", err)
	}
	redisContainer, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{ContainerRequest: testcontainers.ContainerRequest{Image: "redis:7-alpine", ExposedPorts: []string{"6379/tcp"}, Cmd: []string{"redis-server", "--requirepass", "integration-only"}, WaitingFor: wait.ForLog("Ready to accept connections")}, Started: true})
	testcontainers.CleanupContainer(t, redisContainer)
	if err != nil {
		t.Fatal(err)
	}
	redisAddress, err := redisContainer.PortEndpoint(ctx, "6379/tcp", "")
	if err != nil {
		t.Fatal(err)
	}
	cache, err := platformredis.Open(ctx, "redis://:integration-only@"+redisAddress+"/0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := cache.Close(); err != nil {
			t.Errorf("close authentication cache: %v", err)
		}
	})
	hasher, err := password.New(ctx)
	if err != nil {
		t.Fatal(err)
	}
	tokens, err := auth.NewTokens([]byte(rand.Text() + rand.Text()))
	if err != nil {
		t.Fatal(err)
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	vault, err := secrets.New(key)
	if err != nil {
		t.Fatal(err)
	}
	configuration := settings.New(pool, vault, "test", nil)
	billing := credits.New(pool, vault, cache, nil)
	users := user.New(pool, hasher, billing)
	email := "admin@lumi.test"
	value := rand.Text() + "Aa1"
	if err := users.Bootstrap(ctx, email, value, true); err != nil {
		t.Fatal(err)
	}
	sender := &captureMailer{codes: make(map[string]string)}
	services := &account.Services{Auth: auth.New(pool, hasher, tokens, configuration, cache, sender, billing), Users: users, Settings: configuration, Audit: audit.New(pool), Gate: cache, Credits: billing, Catalog: catalog.New(pool, vault, upstream.NetworkPolicy{AllowPrivate: true}, nil)}
	services.Chat = chat.New(pool, services.Catalog, cache)
	engine, err := router.New(slog.New(slog.NewJSONHandler(io.Discard, nil)), handler.Health{Postgres: pool.Ping, Redis: cache.Ping}, handler.Version{}, fstest.MapFS{}, account.Routes(services, account.Security{Origins: []string{"https://lumi.test"}, CookieSecure: true}, slog.New(slog.NewJSONHandler(io.Discard, nil))))
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(engine)
	t.Cleanup(server.Close)
	return &fixture{ctx: ctx, pool: pool, cache: cache, services: services, sender: sender, server: server, adminEmail: email, adminPassword: value, vault: vault}
}

func (f *fixture) client(t *testing.T) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := *f.server.Client()
	client.Jar = jar
	client.Timeout = 15 * time.Second
	return &client
}
func (f *fixture) call(t *testing.T, client *http.Client, method, path, token string, body any, keys ...string) reply {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequestWithContext(f.ctx, method, f.server.URL+path, bytes.NewReader(encoded))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://lumi.test")
	request.Header.Set("X-Lumi-CSRF", "1")
	request.Header.Set("User-Agent", "Lumi integration test")
	if len(keys) > 0 {
		request.Header.Set("Idempotency-Key", keys[0])
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	content, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if err := response.Body.Close(); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode >= 400 {
		var failure struct {
			Code      string `json:"code"`
			RequestID string `json:"request_id"`
		}
		if err := json.Unmarshal(content, &failure); err != nil || failure.Code == "" || failure.RequestID == "" {
			t.Fatalf("invalid API failure envelope: status=%d", response.StatusCode)
		}
	}
	return reply{status: response.StatusCode, body: content, header: response.Header, cookies: response.Cookies()}
}
func expectStatus(t *testing.T, response reply, want int) {
	t.Helper()
	if response.status != want {
		var safe struct {
			Code string `json:"code"`
		}
		if err := json.Unmarshal(response.body, &safe); err != nil {
			t.Fatalf("status=%d want=%d; response was not JSON", response.status, want)
		}
		t.Fatalf("status=%d want=%d code=%s", response.status, want, safe.Code)
	}
}
func decodeReply[T any](t *testing.T, response reply) T {
	t.Helper()
	var result T
	if err := json.Unmarshal(response.body, &result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return result
}
func (f *fixture) login(t *testing.T, client *http.Client, email, value string) auth.Result {
	t.Helper()
	response := f.call(t, client, "POST", "/api/v1/auth/login", "", auth.LoginInput{Email: email, Password: value})
	expectStatus(t, response, 200)
	return decodeReply[auth.Result](t, response)
}

func TestM1Accounts(t *testing.T) {
	f := newAccountFixture(t)
	adminClient := f.client(t)
	admin := f.login(t, adminClient, f.adminEmail, f.adminPassword)
	adminPrincipal, err := f.services.Auth.Authenticate(f.ctx, admin.AccessToken, netip.MustParseAddr("127.0.0.1"))
	if err != nil {
		t.Fatal(err)
	}
	configuration, err := f.services.Settings.Read(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	configuration.Registration.LoginPerMinute = 120
	configuration.Registration.RegisterPerMinute = 60
	configuration.Registration.CodePerMinute = 20
	if _, err := f.services.Settings.Save(f.ctx, adminPrincipal.Actor, "registration", settings.Update{Registration: &configuration.Registration}); err != nil {
		t.Fatal(err)
	}
	email := "member@lumi.test"
	value := rand.Text() + "Aa1"
	memberClient := f.client(t)
	var member auth.Result
	t.Run("verification registration and cookie boundaries", func(t *testing.T) {
		response := f.call(t, memberClient, "POST", "/api/v1/auth/send-code", "", auth.CodeInput{Email: strings.ToUpper(email), Locale: "zh-CN"})
		expectStatus(t, response, 200)
		code := f.sender.code(email)
		if len(code) != 6 {
			t.Fatal("verification was not delivered")
		}
		bad := auth.RegisterInput{Email: email, Password: value, Nickname: "Member", Code: "wrong!", AcceptTerms: true}
		response = f.call(t, memberClient, "POST", "/api/v1/auth/register", "", bad)
		expectStatus(t, response, 400)
		var attempts int
		if err := f.pool.QueryRow(f.ctx, "SELECT attempts FROM verification_codes WHERE target=$1 AND used_at IS NULL", email).Scan(&attempts); err != nil || attempts != 1 {
			t.Fatalf("verification attempts were not committed: %d %v", attempts, err)
		}
		bad.Email = strings.ToUpper(email)
		bad.Code = code
		response = f.call(t, memberClient, "POST", "/api/v1/auth/register", "", bad)
		expectStatus(t, response, 201)
		member = decodeReply[auth.Result](t, response)
		if member.User.Email != email || member.User.Role != "user" {
			t.Fatal("registration did not normalize email and role")
		}
		if len(response.cookies) != 1 {
			t.Fatal("refresh cookie missing")
		}
		cookie := response.cookies[0]
		if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/api/v1/auth" || len(cookie.Value) != 43 {
			t.Fatal("refresh cookie attributes are unsafe")
		}
		if bytes.Contains(response.body, []byte(cookie.Value)) || bytes.Contains(response.body, []byte("password_hash")) {
			t.Fatal("authentication response exposed private fields")
		}
		record, err := query.New(f.pool).GetUserByEmail(f.ctx, email)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(record.PasswordHash, "$argon2id$") || record.PasswordHash == value {
			t.Fatal("password was not hashed")
		}
		expectStatus(t, f.call(t, memberClient, "GET", "/api/v1/me", member.AccessToken, nil), 200)
		expectStatus(t, f.call(t, memberClient, "GET", "/api/v1/admin/users", member.AccessToken, nil), 403)
		expectStatus(t, f.call(t, f.client(t), "GET", "/api/v1/admin/users", "", nil), 401)
		expectStatus(t, f.call(t, memberClient, "PATCH", "/api/v1/me", member.AccessToken, map[string]string{"role": "admin"}), 400)
	})
	t.Run("refresh rotation replay and family isolation", func(t *testing.T) {
		first := f.login(t, memberClient, email, value)
		var oldCookie string
		parsed, err := http.NewRequestWithContext(f.ctx, "POST", f.server.URL+"/api/v1/auth/refresh", nil)
		if err != nil {
			t.Fatal(err)
		}
		for _, cookie := range memberClient.Jar.Cookies(parsed.URL) {
			if cookie.Name == "lumi_refresh" {
				oldCookie = cookie.Value
			}
		}
		response := f.call(t, memberClient, "POST", "/api/v1/auth/refresh", "", nil)
		expectStatus(t, response, 200)
		rotated := decodeReply[auth.Result](t, response)
		if len(response.cookies) != 1 || response.cookies[0].Value == oldCookie {
			t.Fatal("refresh token did not rotate")
		}
		expectStatus(t, f.call(t, memberClient, "GET", "/api/v1/me", first.AccessToken, nil), 200)
		otherClient := f.client(t)
		other := f.login(t, otherClient, email, value)
		attacker := *f.server.Client()
		attacker.Timeout = 15 * time.Second
		request, err := http.NewRequestWithContext(f.ctx, "POST", f.server.URL+"/api/v1/auth/refresh", nil)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Origin", "https://lumi.test")
		request.Header.Set("X-Lumi-CSRF", "1")
		// #nosec G124 -- This is an outbound Cookie header used to test replay, not Set-Cookie.
		request.AddCookie(&http.Cookie{Name: "lumi_refresh", Value: oldCookie})
		result, err := attacker.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		if err := result.Body.Close(); err != nil {
			t.Fatal(err)
		}
		if result.StatusCode != 401 {
			t.Fatal("replayed refresh token was accepted")
		}
		expectStatus(t, f.call(t, memberClient, "GET", "/api/v1/me", rotated.AccessToken, nil), 401)
		expectStatus(t, f.call(t, otherClient, "GET", "/api/v1/me", other.AccessToken, nil), 200)
		expectStatus(t, f.call(t, otherClient, "POST", "/api/v1/auth/logout", "", nil), 204)
		expectStatus(t, f.call(t, otherClient, "GET", "/api/v1/me", other.AccessToken, nil), 401)
		member = f.login(t, memberClient, email, value)
	})
	t.Run("verification codes expire and stop after five failures", func(t *testing.T) {
		for _, target := range []string{"exhausted@lumi.test", "expired@lumi.test"} {
			expectStatus(t, f.call(t, memberClient, "POST", "/api/v1/auth/send-code", "", auth.CodeInput{Email: target}), 200)
			input := auth.RegisterInput{Email: target, Password: rand.Text() + "Aa1", Nickname: "Verification", AcceptTerms: true}
			if strings.HasPrefix(target, "exhausted") {
				input.Code = "wrong!"
				for range 5 {
					expectStatus(t, f.call(t, memberClient, "POST", "/api/v1/auth/register", "", input), 400)
				}
				var attempts int
				if err := f.pool.QueryRow(f.ctx, "SELECT attempts FROM verification_codes WHERE target=$1 AND used_at IS NULL", target).Scan(&attempts); err != nil || attempts != 5 {
					t.Fatalf("verification limit was not persisted: %d %v", attempts, err)
				}
			} else if _, err := f.pool.Exec(f.ctx, "UPDATE verification_codes SET expires_at=now() - interval '1 second' WHERE target=$1", target); err != nil {
				t.Fatal(err)
			}
			input.Code = f.sender.code(target)
			expectStatus(t, f.call(t, memberClient, "POST", "/api/v1/auth/register", "", input), 400)
			if _, err := query.New(f.pool).GetUserByEmail(f.ctx, target); !errors.Is(err, pgx.ErrNoRows) {
				t.Fatal("rejected verification created an account")
			}
		}
	})
	t.Run("administrator CRUD revocation and deletion confirmation", func(t *testing.T) {
		path := "/api/v1/admin/users/" + member.User.ID.String()
		response := f.call(t, adminClient, "PATCH", path, admin.AccessToken, user.UpdateInput{Status: pointer("disabled")})
		expectStatus(t, response, 200)
		expectStatus(t, f.call(t, memberClient, "GET", "/api/v1/me", member.AccessToken, nil), 401)
		expectStatus(t, f.call(t, memberClient, "POST", "/api/v1/auth/login", "", auth.LoginInput{Email: email, Password: value}), 403)
		expectStatus(t, f.call(t, memberClient, "POST", "/api/v1/auth/refresh", "", nil), 401)
		expectStatus(t, f.call(t, adminClient, "PATCH", path, admin.AccessToken, user.UpdateInput{Status: pointer("active")}), 200)
		member = f.login(t, memberClient, email, value)
		newPassword := rand.Text() + "Aa1"
		expectStatus(t, f.call(t, adminClient, "PATCH", path, admin.AccessToken, user.UpdateInput{Password: &newPassword}), 200)
		expectStatus(t, f.call(t, memberClient, "GET", "/api/v1/me", member.AccessToken, nil), 401)
		value = newPassword
		member = f.login(t, memberClient, email, value)
		expectStatus(t, f.call(t, adminClient, "GET", path, admin.AccessToken, nil), 200)
		expectStatus(t, f.call(t, adminClient, "DELETE", path, admin.AccessToken, map[string]string{"email": "wrong@lumi.test"}), 400)
		expectStatus(t, f.call(t, adminClient, "DELETE", "/api/v1/admin/users/"+admin.User.ID.String(), admin.AccessToken, map[string]string{"email": f.adminEmail}), 409)
		expectStatus(t, f.call(t, adminClient, "DELETE", path, admin.AccessToken, map[string]string{"email": email}), 204)
		expectStatus(t, f.call(t, memberClient, "GET", "/api/v1/me", member.AccessToken, nil), 401)
		expectStatus(t, f.call(t, adminClient, "GET", path, admin.AccessToken, nil), 404)
		var deleted bool
		if err := f.pool.QueryRow(f.ctx, "SELECT deleted_at IS NOT NULL FROM users WHERE id=$1", member.User.ID).Scan(&deleted); err != nil || !deleted {
			t.Fatal("user was not soft deleted")
		}
	})
	t.Run("settings invalidation domain rules and secret redaction", func(t *testing.T) {
		configuration, err := f.services.Settings.Read(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		configuration.Site.Name = "Lumi integration"
		expectStatus(t, f.call(t, adminClient, "PUT", "/api/v1/admin/settings/site", admin.AccessToken, settings.Update{Site: &configuration.Site}), 200)
		public := decodeReply[settings.Public](t, f.call(t, memberClient, "GET", "/api/v1/public/config", "", nil))
		if public.Site.Name != "Lumi integration" {
			t.Fatal("settings cache was stale after save")
		}
		secret := rand.Text() + rand.Text()
		mail := settings.MailInput{Host: "smtp.lumi.test", Port: 587, Username: "private-mailbox@lumi.test", From: "noreply@lumi.test", Encryption: "starttls", Password: &secret}
		response := f.call(t, adminClient, "PUT", "/api/v1/admin/settings/mail", admin.AccessToken, settings.Update{Mail: &mail})
		expectStatus(t, response, 200)
		if bytes.Contains(response.body, []byte(secret)) || bytes.Contains(response.body, []byte("password_encrypted")) {
			t.Fatal("SMTP secret leaked in response")
		}
		var stored string
		if err := f.pool.QueryRow(f.ctx, "SELECT value->>'password_encrypted' FROM settings WHERE key='mail'").Scan(&stored); err != nil || stored == secret || stored == "" {
			t.Fatal("SMTP secret was not encrypted")
		}
		configuration.Registration.EmailVerificationEnabled = false
		configuration.Registration.DomainBlocklist = []string{"blocked.test"}
		expectStatus(t, f.call(t, adminClient, "PUT", "/api/v1/admin/settings/registration", admin.AccessToken, settings.Update{Registration: &configuration.Registration}), 200)
		input := auth.RegisterInput{Email: "new@blocked.test", Password: rand.Text() + "Aa1", Nickname: "Blocked", AcceptTerms: true}
		expectStatus(t, f.call(t, memberClient, "POST", "/api/v1/auth/register", "", input), 403)
		configuration.Registration.Enabled = false
		expectStatus(t, f.call(t, adminClient, "PUT", "/api/v1/admin/settings/registration", admin.AccessToken, settings.Update{Registration: &configuration.Registration}), 200)
		input.Email = "closed@lumi.test"
		expectStatus(t, f.call(t, memberClient, "POST", "/api/v1/auth/register", "", input), 403)
		configuration.Registration.Enabled = true
		expectStatus(t, f.call(t, adminClient, "PUT", "/api/v1/admin/settings/registration", admin.AccessToken, settings.Update{Registration: &configuration.Registration}), 200)
		var history string
		if err := f.pool.QueryRow(f.ctx, `SELECT coalesce(string_agg(coalesce("before"::text,'') || coalesce("after"::text,''), ''),'') FROM audit_logs`).Scan(&history); err != nil {
			t.Fatal(err)
		}
		for _, private := range []string{secret, value, admin.AccessToken} {
			if strings.Contains(history, private) {
				t.Fatal("audit history contains a private credential")
			}
		}
		if _, err := f.pool.Exec(f.ctx, "UPDATE audit_logs SET action='tampered'"); err == nil {
			t.Fatal("audit history was mutable")
		}
	})
	t.Run("case insensitive concurrent registration and cursor pagination", func(t *testing.T) {
		input := auth.RegisterInput{Email: email, Password: rand.Text() + "Aa1", Nickname: "Recreated", AcceptTerms: true}
		response := f.call(t, memberClient, "POST", "/api/v1/auth/register", "", input)
		expectStatus(t, response, 201)
		replacement := decodeReply[auth.Result](t, response)
		if replacement.User.ID == member.User.ID {
			t.Fatal("deleted account identity was reused")
		}
		var group sync.WaitGroup
		results := make(chan error, 2)
		for _, address := range []string{"Concurrent@lumi.test", "CONCURRENT@lumi.test"} {
			address := address
			group.Go(func() {
				_, err := f.services.Auth.Register(f.ctx, auth.RegisterInput{Email: address, Password: rand.Text() + "Aa1", Nickname: "Concurrent", AcceptTerms: true}, auth.Client{IP: netip.MustParseAddr("192.0.2.10")})
				results <- err
			})
		}
		group.Wait()
		close(results)
		success := 0
		for err := range results {
			if err == nil {
				success++
			}
		}
		if success != 1 {
			t.Fatalf("concurrent registration successes=%d", success)
		}
		for range 3 {
			_, err := f.services.Users.Create(f.ctx, adminPrincipal.Actor, user.CreateInput{Email: strings.ToLower(rand.Text()) + "@lumi.test", Password: rand.Text() + "Aa1", Nickname: "Paged", Role: "user"})
			if err != nil {
				t.Fatal(err)
			}
		}
		first := decodeReply[user.Page](t, f.call(t, adminClient, "GET", "/api/v1/admin/users?limit=2", admin.AccessToken, nil))
		if len(first.Items) != 2 || first.NextCursor == "" {
			t.Fatal("first cursor page missing")
		}
		second := decodeReply[user.Page](t, f.call(t, adminClient, "GET", "/api/v1/admin/users?limit=2&cursor="+first.NextCursor, admin.AccessToken, nil))
		for _, left := range first.Items {
			for _, right := range second.Items {
				if left.ID == right.ID {
					t.Fatal("cursor page repeated a user")
				}
			}
		}
		expectStatus(t, f.call(t, adminClient, "GET", "/api/v1/admin/users?limit=2&role=admin&cursor="+first.NextCursor, admin.AccessToken, nil), 400)
		expectStatus(t, f.call(t, adminClient, "GET", "/api/v1/admin/audit-logs?limit=2", admin.AccessToken, nil), 200)
	})
	t.Run("retention cleanup preserves recent deletions and audit history", func(t *testing.T) {
		actor := adminPrincipal.Actor
		for _, expired := range []bool{true, false} {
			targetEmail := strings.ToLower(rand.Text()) + "@lumi.test"
			targetPassword := rand.Text() + "Aa1"
			target, err := f.services.Users.Create(f.ctx, actor, user.CreateInput{Email: targetEmail, Password: targetPassword, Nickname: "Retention", Role: "user"})
			if err != nil {
				t.Fatal(err)
			}
			f.login(t, f.client(t), targetEmail, targetPassword)
			if err := f.services.Users.Delete(f.ctx, actor, target.ID, targetEmail); err != nil {
				t.Fatal(err)
			}
			days := 29
			if expired {
				days = 31
			}
			if _, err := f.pool.Exec(f.ctx, "UPDATE users SET deleted_at=now() - make_interval(days => $2) WHERE id=$1", target.ID, days); err != nil {
				t.Fatal(err)
			}
			count := 0
			if expired {
				var group sync.WaitGroup
				type purgeResult struct {
					count int
					err   error
				}
				results := make(chan purgeResult, 2)
				for range 2 {
					group.Go(func() {
						n, err := f.services.Users.PurgeDeleted(f.ctx, 100)
						results <- purgeResult{n, err}
					})
				}
				group.Wait()
				close(results)
				for result := range results {
					if result.err != nil {
						t.Fatal(result.err)
					}
					count += result.count
				}
			} else {
				count, err = f.services.Users.PurgeDeleted(f.ctx, 100)
			}
			want := 0
			if expired {
				want = 1
			}
			if err != nil || count != want {
				t.Fatalf("retention count=%d want=%d error=%v", count, want, err)
			}
			var accountCount, sessionCount, auditCount, purgeCount int
			if err := f.pool.QueryRow(f.ctx, "SELECT (SELECT count(*) FROM users WHERE id=$1), (SELECT count(*) FROM user_sessions WHERE user_id=$1), (SELECT count(*) FROM audit_logs WHERE target_id=$1), (SELECT count(*) FROM audit_logs WHERE target_id=$1 AND action='user.purge')", target.ID).Scan(&accountCount, &sessionCount, &auditCount, &purgeCount); err != nil {
				t.Fatal(err)
			}
			if auditCount == 0 || purgeCount != want || (expired && (accountCount != 0 || sessionCount != 0)) || (!expired && (accountCount != 1 || sessionCount != 1)) {
				t.Fatal("retention removed recent data or failed to preserve audit history")
			}
		}
		if count, err := f.services.Users.PurgeDeleted(f.ctx, 100); err != nil || count != 0 {
			t.Fatalf("repeated retention cleanup was not idempotent: %d %v", count, err)
		}
	})
	t.Run("five failed logins lock the account and IP pair", func(t *testing.T) {
		client := auth.Client{IP: netip.MustParseAddr("192.0.2.99")}
		for attempt := 1; attempt <= 5; attempt++ {
			_, err := f.services.Auth.Login(f.ctx, auth.LoginInput{Email: f.adminEmail, Password: "IncorrectPassword42"}, client)
			if err == nil {
				t.Fatal("incorrect password accepted")
			}
		}
		locked, retry, err := f.cache.LoginLocked(f.ctx, f.adminEmail+"\x00"+client.IP.String())
		if err != nil || !locked || retry < 14*60 || retry > 901 {
			t.Fatalf("lock state invalid: locked=%v retry=%d error=%v", locked, retry, err)
		}
		if _, err := f.services.Auth.Login(f.ctx, auth.LoginInput{Email: f.adminEmail, Password: f.adminPassword}, client); err == nil {
			t.Fatal("locked account signed in")
		}
		if _, err := f.services.Auth.Login(f.ctx, auth.LoginInput{Email: f.adminEmail, Password: f.adminPassword}, auth.Client{IP: netip.MustParseAddr("192.0.2.100")}); err != nil {
			t.Fatalf("independent IP was locked: %v", err)
		}
	})
	t.Run("password change and CLI recovery revoke existing access", func(t *testing.T) {
		client := f.client(t)
		original := inputPasswordFor(t, f, email)
		current := f.login(t, client, email, original)
		next := rand.Text() + "Aa1"
		expectStatus(t, f.call(t, client, "POST", "/api/v1/me/password", current.AccessToken, user.PasswordInput{CurrentPassword: original, NewPassword: next}), 204)
		expectStatus(t, f.call(t, client, "GET", "/api/v1/me", current.AccessToken, nil), 401)
		expectStatus(t, f.call(t, client, "POST", "/api/v1/auth/refresh", "", nil), 401)
		f.login(t, client, email, next)
		reset := rand.Text() + "Aa1"
		if err := f.services.Users.ResetAdminPassword(f.ctx, f.adminEmail, reset); err != nil {
			t.Fatal(err)
		}
		expectStatus(t, f.call(t, adminClient, "GET", "/api/v1/me", admin.AccessToken, nil), 401)
		f.adminPassword = reset
		admin = f.login(t, adminClient, f.adminEmail, reset)
		if err := f.services.Users.Bootstrap(f.ctx, f.adminEmail, rand.Text()+"Aa1", true); err != nil {
			t.Fatal(err)
		}
		f.login(t, adminClient, f.adminEmail, reset)
	})
}

// A pointer helper keeps optional PATCH fields explicit in these API tests.
func pointer(value string) *string { return &value }

func inputPasswordFor(t *testing.T, f *fixture, email string) string {
	t.Helper()
	next := rand.Text() + "Aa1"
	admin, err := query.New(f.pool).GetUserByEmail(f.ctx, f.adminEmail)
	if err != nil {
		t.Fatal(err)
	}
	record, err := query.New(f.pool).GetUserByEmail(f.ctx, email)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.services.Users.Update(f.ctx, user.Actor{ID: admin.ID, TokenVersion: admin.TokenVersion, IP: netip.MustParseAddr("127.0.0.1")}, record.ID, user.UpdateInput{Password: &next}); err != nil {
		t.Fatal(err)
	}
	return next
}

func TestM1ConcurrentAdministratorChanges(t *testing.T) {
	f := newAccountFixture(t)
	record, err := query.New(f.pool).GetUserByEmail(f.ctx, f.adminEmail)
	if err != nil {
		t.Fatal(err)
	}
	first := user.Actor{ID: record.ID, TokenVersion: record.TokenVersion, IP: netip.MustParseAddr("127.0.0.1")}
	other, err := f.services.Users.Create(f.ctx, first, user.CreateInput{Email: "second@lumi.test", Password: rand.Text() + "Aa1", Nickname: "Second", Role: "admin"})
	if err != nil {
		t.Fatal(err)
	}
	second := user.Actor{ID: other.ID, TokenVersion: 0, IP: first.IP}
	results := make(chan error, 2)
	var group sync.WaitGroup
	group.Go(func() {
		_, err := f.services.Users.Update(f.ctx, first, second.ID, user.UpdateInput{Status: pointer("disabled")})
		results <- err
	})
	group.Go(func() {
		_, err := f.services.Users.Update(f.ctx, second, first.ID, user.UpdateInput{Status: pointer("disabled")})
		results <- err
	})
	group.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		}
	}
	count, err := query.New(f.pool).CountActiveAdmins(f.ctx)
	if err != nil || count != 1 || success != 1 {
		t.Fatalf("administrator invariant failed: count=%d success=%d error=%v", count, success, err)
	}
}

func TestM1AuditFailureRollsBackBusinessChange(t *testing.T) {
	f := newAccountFixture(t)
	record, err := query.New(f.pool).GetUserByEmail(f.ctx, f.adminEmail)
	if err != nil {
		t.Fatal(err)
	}
	actor := user.Actor{ID: record.ID, TokenVersion: record.TokenVersion, IP: netip.MustParseAddr("127.0.0.1")}
	target, err := f.services.Users.Create(f.ctx, actor, user.CreateInput{Email: "retention-rollback@lumi.test", Password: rand.Text() + "Aa1", Nickname: "Retention rollback", Role: "user"})
	if err != nil {
		t.Fatal(err)
	}
	if err := f.services.Users.Delete(f.ctx, actor, target.ID, target.Email); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, "UPDATE users SET deleted_at=now() - interval '31 days' WHERE id=$1", target.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `CREATE FUNCTION lumi.test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END; $$; CREATE TRIGGER test_reject_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION lumi.test_reject_audit();`); err != nil {
		t.Fatal(err)
	}
	_, err = f.services.Users.Create(f.ctx, user.Actor{ID: record.ID, TokenVersion: record.TokenVersion, IP: netip.MustParseAddr("127.0.0.1")}, user.CreateInput{Email: "rollback@lumi.test", Password: rand.Text() + "Aa1", Nickname: "Rollback", Role: "user"})
	if err == nil {
		t.Fatal("audit failure was ignored")
	}
	if _, err := query.New(f.pool).GetUserByEmail(f.ctx, "rollback@lumi.test"); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("business change survived failed audit: %v", err)
	}
	if _, err := f.services.Users.PurgeDeleted(f.ctx, 100); err == nil {
		t.Fatal("retention ignored an audit failure")
	}
	var retained bool
	if err := f.pool.QueryRow(f.ctx, "SELECT EXISTS(SELECT 1 FROM users WHERE id=$1)", target.ID).Scan(&retained); err != nil || !retained {
		t.Fatalf("retention deleted data despite an audit failure: retained=%v error=%v", retained, err)
	}
}
