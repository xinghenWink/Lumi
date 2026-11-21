package upstream_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/xinghenWink/Lumi/backend/internal/upstream"
)

func TestImageComplexityWire(t *testing.T) {
	for _, format := range []string{"generation", "json", "multipart"} {
		for _, level := range []string{"", "low", "medium", "high"} {
			t.Run(format+"/"+level, func(t *testing.T) {
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
					var complexity []string
					if format == "multipart" {
						reader, err := r.MultipartReader()
						if err != nil {
							t.Error(err)
							w.WriteHeader(400)
							return
						}
						form, err := reader.ReadForm(1 << 20)
						if err != nil {
							t.Error(err)
							w.WriteHeader(400)
							return
						}
						defer func() {
							if err := form.RemoveAll(); err != nil {
								t.Error(err)
							}
						}()
						complexity = form.Value["complexity"]
					} else {
						var payload map[string]json.RawMessage
						if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
							t.Error(err)
							w.WriteHeader(400)
							return
						}
						if value, present := payload["complexity"]; present {
							var planned string
							if err := json.Unmarshal(value, &planned); err != nil {
								t.Error(err)
							}
							complexity = []string{planned}
						}
					}
					if level == "" {
						if len(complexity) != 0 {
							t.Errorf("default planning should omit complexity, got %q", complexity)
						}
					} else if len(complexity) != 1 || complexity[0] != level {
						t.Errorf("complexity = %q, want one value %q", complexity, level)
					}
					if _, err := io.WriteString(w, `{"data":[{"b64_json":"aW1hZ2U="}]}`); err != nil {
						t.Error(err)
					}
				}))
				defer server.Close()
				editFormat := format
				if format == "generation" {
					editFormat = "json"
				}
				client, err := upstream.NewClient(upstream.Connection{
					BaseURL: server.URL + "/v1", APIKey: "test", EditFormat: editFormat,
					ChatTimeout: time.Second, ImageTimeout: time.Second,
				}, upstream.NetworkPolicy{AllowPrivate: true}, nil)
				if err != nil {
					t.Fatal(err)
				}
				defer client.Close()
				input := upstream.ImageRequest{Model: "image", Prompt: "fixture", Quality: "low", Complexity: level, Size: "1024x1024", Count: 1}
				if format == "generation" {
					_, err = client.GenerateImages(t.Context(), input)
				} else {
					_, err = client.EditImages(t.Context(), upstream.EditRequest{
						ImageRequest: input,
						References:   []upstream.Reference{{MIME: "image/png", Data: []byte("fixture")}},
					})
				}
				if err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}
