package account

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/xinghenWink/Lumi/backend/internal/auth"
	"github.com/xinghenWink/Lumi/backend/internal/http/middleware"
)

func TestCSRFProtection(t *testing.T) {
	h := Handler{security: Security{Origins: []string{"https://lumi.test"}}, logger: slog.New(slog.NewJSONHandler(io.Discard, nil))}
	engine := gin.New()
	engine.Use(middleware.RequestContext())
	engine.POST("/cookie", h.csrf, func(c *gin.Context) { c.Status(http.StatusNoContent) })
	for _, test := range []struct {
		origin, referer, header string
		want                    int
	}{{"https://lumi.test", "", "1", 204}, {"", "https://lumi.test/account", "1", 204}, {"https://evil.test", "", "1", 403}, {"null", "", "1", 403}, {"https://lumi.test", "", "", 403}, {"", "", "1", 403}} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/cookie", nil)
		request.Header.Set("Origin", test.origin)
		request.Header.Set("Referer", test.referer)
		request.Header.Set("X-Lumi-CSRF", test.header)
		engine.ServeHTTP(recorder, request)
		if recorder.Code != test.want {
			t.Errorf("origin=%q referer=%q status=%d", test.origin, test.referer, recorder.Code)
		}
	}
}

func TestRefreshCookieSecurity(t *testing.T) {
	h := Handler{security: Security{CookieSecure: true}}
	engine := gin.New()
	engine.POST("/issue", func(c *gin.Context) {
		h.setCookie(c, auth.Result{RefreshToken: "private-refresh", RefreshExpires: time.Now().Add(30 * 24 * time.Hour)})
	})
	engine.POST("/clear", h.clearCookie)
	for _, path := range []string{"/issue", "/clear"} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, path, nil))
		cookies := recorder.Result().Cookies()
		if len(cookies) != 1 {
			t.Fatalf("%s cookie count = %d", path, len(cookies))
		}
		cookie := cookies[0]
		if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || cookie.Domain != "" || cookie.Path != "/api/v1/auth" {
			t.Fatalf("%s lost cookie security attributes", path)
		}
		if path == "/clear" && (cookie.Value != "" || cookie.MaxAge != -1) {
			t.Fatal("logout did not expire the cookie")
		}
	}
}

func TestStrictJSON(t *testing.T) {
	engine := gin.New()
	engine.POST("/body", func(c *gin.Context) {
		var input struct {
			Email string `json:"email"`
		}
		if err := decode(c, &input); err != nil {
			c.Status(400)
			return
		}
		c.Status(204)
	})
	for _, test := range []struct {
		body string
		want int
	}{{`{"email":"a@lumi.test"}`, 204}, {`{"email":"a@lumi.test","role":"admin"}`, 400}, {`{} {}`, 400}, {strings.Repeat(" ", 65537) + "{}", 400}} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest("POST", "/body", strings.NewReader(test.body))
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, request)
		if recorder.Code != test.want {
			t.Errorf("length=%d status=%d", len(test.body), recorder.Code)
		}
	}
}
