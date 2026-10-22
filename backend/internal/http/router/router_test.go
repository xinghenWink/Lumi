package router

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/gin-gonic/gin"

	"github.com/xinghenWink/Lumi/backend/internal/http/handler"
	"github.com/xinghenWink/Lumi/backend/internal/http/middleware"
	"github.com/xinghenWink/Lumi/backend/internal/http/response"
)

func TestInfrastructureRoutes(t *testing.T) {
	for _, dependencies := range []struct {
		name   string
		health handler.Health
		status int
	}{
		{"missing", handler.Health{}, http.StatusServiceUnavailable},
		{"ready", handler.Health{Postgres: successfulCheck, Redis: successfulCheck}, http.StatusOK},
		{"database unavailable", handler.Health{Postgres: failedCheck, Redis: successfulCheck}, http.StatusServiceUnavailable},
		{"cache unavailable", handler.Health{Postgres: successfulCheck, Redis: failedCheck}, http.StatusServiceUnavailable},
	} {
		t.Run(dependencies.name, func(t *testing.T) {
			t.Parallel()
			engine, err := New(slog.New(slog.NewJSONHandler(io.Discard, nil)), dependencies.health,
				handler.Version{Version: "test", Commit: "abc123", BuildTime: "2026-10-22T00:00:00Z"},
				fstest.MapFS{"index.html": {Data: []byte("<html>Lumi</html>")}, "assets/main.js": {Data: []byte("export {}")}})
			if err != nil {
				t.Fatalf("New: %v", err)
			}
			for _, route := range []struct {
				path   string
				status int
			}{
				{"/healthz", 200}, {"/readyz", dependencies.status}, {"/api/version", 200},
				{"/api/v1/missing", 404}, {"/api", 404}, {"/", 200}, {"/chat/example", 200},
				{"/assets/main.js", 200}, {"/assets/missing.js", 404}, {"/favicon.ico", 404},
			} {
				request := httptest.NewRequest(http.MethodGet, route.path, nil)
				request.Header.Set("X-Request-ID", "untrusted")
				recorder := httptest.NewRecorder()
				engine.ServeHTTP(recorder, request)
				if recorder.Code != route.status {
					t.Errorf("%s status = %d, want %d; body=%s", route.path, recorder.Code, route.status, recorder.Body)
				}
				id := recorder.Header().Get("X-Request-ID")
				if id == "" || id == "untrusted" {
					t.Errorf("%s missing server-generated request ID", route.path)
				}
				if recorder.Header().Get("Content-Security-Policy") == "" || recorder.Header().Get("X-Content-Type-Options") != "nosniff" {
					t.Errorf("%s missing security headers", route.path)
				}
				if recorder.Code >= 400 {
					var body response.Error
					if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
						t.Fatalf("decode error: %v", err)
					}
					if body.Code == "" || body.Message == "" || body.RequestID != id || strings.Contains(body.Message, "credential") {
						t.Errorf("invalid error body: %+v", body)
					}
				}
				if route.path == "/api/version" {
					var body handler.Version
					if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil || body.Version != "test" || body.Commit != "abc123" {
						t.Errorf("invalid version response: %s", recorder.Body)
					}
				}
			}
		})
	}
}

func TestRecoveryAndLogRedaction(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	engine, err := New(logger, handler.Health{}, handler.Version{}, fstest.MapFS{})
	if err != nil {
		t.Fatal(err)
	}
	engine.GET("/panic", func(c *gin.Context) {
		if middleware.RequestID(c.Request.Context()) == "" {
			t.Error("request ID missing from context")
		}
		panic("credential-from-panic")
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/panic?token=credential-from-query", nil)
	request.Header.Set("Authorization", "Bearer credential-from-header")
	engine.ServeHTTP(recorder, request)
	if recorder.Code != 500 || !strings.Contains(recorder.Body.String(), "INTERNAL_ERROR") {
		t.Fatalf("panic response: %d %s", recorder.Code, recorder.Body)
	}
	if strings.Contains(logs.String(), "credential") {
		t.Fatalf("logs leaked request or panic contents: %s", logs.String())
	}
}

func successfulCheck(context.Context) error { return nil }
func failedCheck(context.Context) error     { return fmt.Errorf("credential must remain private") }
