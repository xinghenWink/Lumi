package video

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/xinghenWink/Lumi/backend/internal/upstream"
)

func TestVideoContracts(t *testing.T) {
	tests := []struct {
		name, protocol, profile, model, post, query, result, createJSON, queryJSON, bodyMarker string
		authenticatedContent                                                                   bool
	}{
		{"Ark", "ark", "", "seedance-fixture", "/api/v3/contents/generations/tasks", "/api/v3/contents/generations/tasks/task-1", "/artifact", `{"id":"task-1"}`, `{"id":"task-1","status":"succeeded","content":{"video_url":%q}}`, `"role":"reference_video"`, false},
		{"Wan", "dashscope", "", "wan3.0-video", "/api/v1/services/aigc/video-generation/video-synthesis", "/api/v1/tasks/task-1", "/artifact", `{"output":{"task_id":"task-1","task_status":"PENDING"}}`, `{"output":{"task_id":"task-1","task_status":"SUCCEEDED","video_url":%q}}`, `"type":"reference_video"`, false},
		{"H3", "minimax_v2", "", "MiniMax-H3", "/v2/video_generation", "/v2/query/video_generation/task-1", "/artifact", `{"task_id":"task-1"}`, `{"task":{"id":"task-1","status":"succeeded","content":{"url":%q}}}`, `<Video 1>`, false},
		{"Kling", "kling_new", "", "kling-4.0", "/omni-video/kling-4.0", "/tasks", "/artifact", `{"code":0,"data":{"id":"task-1","status":"submitted"}}`, `{"data":[{"id":"task-1","status":"succeeded","outputs":[{"type":"video","url":%q}]}]}`, `"type":"feature_video"`, false},
		{"New API Doubao", "openai_video", "doubao", "mapped-seedance", "/v1/videos", "/v1/videos/task-1", "/v1/videos/task-1/content", `{"id":"task-1","status":"queued"}`, `{"id":"task-1","status":"completed"}`, `"metadata":`, true},
		{"New API Bailian", "openai_video", "alibaba", "mapped-wan", "/v1/videos", "/v1/videos/task-1", "/v1/videos/task-1/content", `{"id":"task-1","status":"queued"}`, `{"id":"task-1","status":"completed"}`, `"parameters":`, true},
		{"New API Hailuo", "openai_video", "hailuo", "MiniMax-H3", "/v1/videos", "/v1/videos/task-1", "/v1/videos/task-1/content", `{"id":"task-1","status":"queued"}`, `{"id":"task-1","status":"completed"}`, `"content":`, true},
		{"New API Kling", "openai_video", "kling", "kling-4.0", "/omni-video/kling-4.0", "/tasks", "/v1/videos/task-1/content", `{"code":0,"data":{"id":"task-1","status":"submitted"}}`, `{"data":[{"id":"task-1","status":"succeeded","outputs":[{"type":"video","url":%q}]}]}`, `"type":"feature_video"`, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				origin := "http://" + r.Host
				auth := r.Header.Get("Authorization")
				if r.URL.Path != tc.result || tc.authenticatedContent {
					if auth != "Bearer fixture-key" {
						t.Error("authorization missing")
					}
				} else if auth != "" {
					t.Error("provider credentials reached artifact host")
				}
				var body string
				switch {
				case r.Method == http.MethodPost && r.URL.Path == tc.post:
					if tc.protocol == "dashscope" && r.Header.Get("X-DashScope-Async") != "enable" {
						t.Error("async header missing")
					}
					var value map[string]any
					if err := json.NewDecoder(r.Body).Decode(&value); err != nil {
						t.Error(err)
					}
					raw, err := json.Marshal(value)
					if err != nil {
						t.Error(err)
					}
					check := strings.ReplaceAll(strings.ReplaceAll(string(raw), `\u003c`, "<"), `\u003e`, ">")
					if !strings.Contains(check, tc.bodyMarker) {
						t.Errorf("missing %s", tc.bodyMarker)
					}
					body = tc.createJSON
				case r.Method == http.MethodGet && r.URL.Path == tc.query:
					if tc.query == "/tasks" && r.URL.Query().Get("task_ids") != "task-1" {
						t.Error("task query missing ID")
					}
					body = tc.queryJSON
					if strings.Contains(body, "%q") {
						body = fmt.Sprintf(body, origin+tc.result)
					}
				case r.Method == http.MethodGet && r.URL.Path == tc.result:
					body = "fixture-mp4"
				default:
					t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
					http.NotFound(w, r)
					return
				}
				if _, err := io.WriteString(w, body); err != nil { // #nosec G705 -- Fixed HTTP fixture payloads.
					t.Error(err)
				}
			}))
			defer server.Close()
			base := server.URL
			if tc.protocol == "openai_video" {
				base += "/v1"
			}
			adapter, err := Builtins(upstream.NetworkPolicy{AllowPrivate: true}).Open(tc.protocol, tc.profile, Connection{BaseURL: base, Key: "fixture-key"})
			if err != nil {
				t.Fatal(err)
			}
			id, err := adapter.Submit(t.Context(), Request{Model: tc.model, Prompt: "Use @[video1]", Options: Options{Mode: Reference, Ratio: "16:9", Resolution: "720p", Duration: 5}, References: []ReferenceInput{{Role: Video, Token: "@[video1]", URL: "https://fixture.test/ref.mp4"}}})
			if err != nil || id != "task-1" {
				t.Fatalf("submit %q: %v", id, err)
			}
			snapshot, err := adapter.Query(t.Context(), id)
			if err != nil || snapshot.State != Succeeded {
				t.Fatalf("query %+v: %v", snapshot, err)
			}
			file, err := adapter.Download(t.Context(), snapshot)
			if err != nil {
				t.Fatal(err)
			}
			data, err := io.ReadAll(file)
			if closeErr := file.Close(); closeErr != nil {
				t.Error(closeErr)
			}
			if err != nil || string(data) != "fixture-mp4" {
				t.Fatalf("download %q: %v", data, err)
			}
		})
	}
}

func TestAmbiguousSubmitAndDefiniteRefusal(t *testing.T) {
	for _, status := range []int{http.StatusTooManyRequests, http.StatusGatewayTimeout, http.StatusOK} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(status) }))
			defer server.Close()
			adapter, err := Builtins(upstream.NetworkPolicy{AllowPrivate: true}).Open("ark", "", Connection{BaseURL: server.URL, Key: "fixture-key"})
			if err != nil {
				t.Fatal(err)
			}
			_, err = adapter.Submit(t.Context(), Request{Model: "test"})
			if err == nil || IsDefinite(err) != (status == http.StatusTooManyRequests) {
				t.Fatalf("unexpected classification: %v", err)
			}
		})
	}
}
