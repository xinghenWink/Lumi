package account

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestReadAdmissionPreservesInteractiveCapacity(t *testing.T) {
	engine := gin.New()
	engine.Use(admitReads(1))
	started, release, finished := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var reads atomic.Int32
	engine.GET("/api/v1/me", func(c *gin.Context) {
		if reads.Add(1) == 1 {
			close(started)
		}
		<-release
		c.Status(http.StatusNoContent)
	})
	for _, path := range []string{"/api/v1/conversations/:id/events", "/api/v1/image-tasks/:id/events", "/api/v1/files/:id", "/api/v1/files/:id/thumb", "/api/v1/admin/users/export"} {
		engine.GET(path, func(c *gin.Context) { c.Status(http.StatusNoContent) })
	}
	engine.POST("/api/v1/conversations/:id/messages", func(c *gin.Context) { c.Status(http.StatusNoContent) })
	engine.POST("/api/v1/conversations/:id/stop", func(c *gin.Context) { c.Status(http.StatusNoContent) })
	go func() {
		defer close(finished)
		engine.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/v1/me", nil))
	}()
	defer func() { close(release); <-finished }()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("initial reader did not start")
	}

	// A canceled waiter must not reach authentication or business handlers.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	engine.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/v1/me", nil).WithContext(ctx))
	if reads.Load() != 1 {
		t.Fatal("queued canceled read reached the handler")
	}
	for _, test := range []struct{ method, path string }{
		{http.MethodPost, "/api/v1/conversations/one/messages"},
		{http.MethodPost, "/api/v1/conversations/one/stop"},
		{http.MethodGet, "/api/v1/conversations/one/events"},
		{http.MethodGet, "/api/v1/image-tasks/one/events"},
		{http.MethodGet, "/api/v1/files/one"},
		{http.MethodGet, "/api/v1/files/one/thumb"},
		{http.MethodGet, "/api/v1/admin/users/export"},
	} {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(test.method, test.path, nil).WithContext(ctx))
		cancel()
		if recorder.Code != http.StatusNoContent {
			t.Errorf("interactive request %s %s waited behind a reader", test.method, test.path)
		}
	}
}
