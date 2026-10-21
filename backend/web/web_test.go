package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/gin-gonic/gin"
)

func TestAssetFallbackAndCaching(t *testing.T) {
	content := fstest.MapFS{
		"index.html":    {Data: []byte("<html>Lumi</html>")},
		"assets/app.js": {Data: []byte("export {}")},
	}
	engine := gin.New()
	engine.NoRoute(Handler(content))
	for _, tt := range []struct {
		method, path string
		status       int
		cache        string
	}{
		{"GET", "/", 200, "no-cache"},
		{"GET", "/chat/123", 200, "no-cache"},
		{"HEAD", "/", 200, "no-cache"},
		{"GET", "/assets/app.js", 200, "public, max-age=31536000, immutable"},
		{"GET", "/assets/absent.js", 404, ""},
		{"GET", "/assets/no-extension", 404, ""},
		{"POST", "/chat/123", 404, ""},
		{"GET", "/api/v1/missing", 404, ""},
	} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(tt.method, tt.path, nil))
		if recorder.Code != tt.status || recorder.Header().Get("Cache-Control") != tt.cache {
			t.Errorf("%s %s: status=%d cache=%q", tt.method, tt.path, recorder.Code, recorder.Header().Get("Cache-Control"))
		}
		if tt.method == http.MethodHead && recorder.Body.Len() != 0 {
			t.Error("HEAD returned a body")
		}
	}
}

func TestUnbuiltFrontend(t *testing.T) {
	engine := gin.New()
	engine.NoRoute(Handler(fstest.MapFS{}))
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/", nil))
	if recorder.Code != 503 || !strings.Contains(recorder.Body.String(), "WEB_BUILD_REQUIRED") {
		t.Fatalf("unbuilt frontend response: %d %s", recorder.Code, recorder.Body)
	}
}
