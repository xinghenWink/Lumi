package probe

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/xinghenWink/Lumi/backend/internal/upstream"
)

func TestProbeObservesShapesWithoutSavingSecretsOrImages(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer probe-test-secret" {
			t.Error("missing upstream authentication")
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/models":
			writeProbeResponse(t, w, `{"data":[{"id":"text-model"},{"id":"probe-test-secret"}]}`)
		case "/v1/chat/completions":
			w.Header().Set("Content-Type", "text/event-stream")
			writeProbeResponse(t, w, "data: {\"id\":\"observed\",\"choices\":[{\"delta\":{\"content\":\"do-not-save-content\"}}]}\n\ndata: [DONE]\n\n")
		case "/v1/images/generations", "/v1/images/edits":
			if r.URL.Path == "/v1/images/edits" {
				r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
				if err := r.ParseMultipartForm(1 << 20); err != nil { // #nosec G120 -- MaxBytesReader above caps the entire test request at 1 MiB.
					t.Error(err)
				}
				if r.MultipartForm != nil {
					defer func() {
						if err := r.MultipartForm.RemoveAll(); err != nil {
							t.Error(err)
						}
					}()
				}
				file, _, err := r.FormFile("image")
				if err != nil {
					t.Error("missing multipart image")
				} else {
					if err := file.Close(); err != nil {
						t.Error(err)
					}
				}
			}
			writeProbeResponse(t, w, `{"data":[{"b64_json":"do-not-save-image"}]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	report, err := Run(t.Context(), Options{BaseURL: server.URL + "/v1", APIKey: "probe-test-secret", ChatModel: "text-model", ImageModel: "image-model", Images: true, Edit: true, EditFormat: "multipart", Count: 1, Quality: "low", Size: "1024x1024", Policy: upstream.NetworkPolicy{AllowPrivate: true}})
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"probe-test-secret", "do-not-save-content", "do-not-save-image"} {
		if strings.Contains(string(encoded), secret) {
			t.Fatalf("report leaked %s", secret)
		}
	}
	if len(report.Observations) != 4 || len(report.Observations[0].Models) != 1 || !report.Observations[1].Done || report.Observations[2].Results != 1 {
		t.Fatalf("unexpected observations: %s", encoded)
	}
}

func TestProbeReportsInterruptedStreamsAndRateLimits(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/models" {
			w.WriteHeader(http.StatusTooManyRequests)
			writeProbeResponse(t, w, `{"error":{"message":"secret-body"}}`)
			return
		}
		writeProbeResponse(t, w, "data: {\"choices\":[]}\n\n")
	}))
	defer server.Close()
	report, err := Run(t.Context(), Options{BaseURL: server.URL, APIKey: "test-key", ChatModel: "text", EditFormat: "json", Count: 1, Policy: upstream.NetworkPolicy{AllowPrivate: true}})
	if err != nil || len(report.Observations) != 2 {
		t.Fatalf("probe failed: %v", err)
	}
	if report.Observations[0].Error != "RATE_LIMITED" || report.Observations[1].Error != "STREAM_INTERRUPTED" {
		t.Fatalf("missing error observations: %+v", report.Observations)
	}
}

func writeProbeResponse(t *testing.T, w http.ResponseWriter, body string) {
	t.Helper()
	if _, err := fmt.Fprint(w, body); err != nil {
		t.Error(err)
	}
}
