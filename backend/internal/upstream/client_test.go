package upstream_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/xinghenWink/Lumi/backend/internal/upstream"
	"github.com/xinghenWink/Lumi/backend/internal/upstream/mock"
)

func adapter(t *testing.T, configuration mock.Configuration, format string, timeout time.Duration) *upstream.Client {
	t.Helper()
	server := mock.New(configuration)
	t.Cleanup(server.Close)
	client, err := upstream.NewClient(upstream.Connection{BaseURL: server.URL + "/v1", APIKey: "fixture-key", ChatTimeout: timeout, ImageTimeout: timeout, EditFormat: format}, upstream.NetworkPolicy{AllowPrivate: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	return client
}
func TestAdapterModelsStreamsAndImages(t *testing.T) {
	client := adapter(t, mock.Configuration{APIKey: "fixture-key", Models: []string{"text", "text", "image"}}, "multipart", time.Second)
	models, err := client.ListModels(t.Context())
	if err != nil || len(models) != 2 {
		t.Fatalf("models=%v error=%v", models, err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	events, err := client.ChatStream(ctx, upstream.ChatRequest{Model: "text", Messages: []upstream.Message{{Role: "user", Content: json.RawMessage(`"Hi"`)}}})
	if err != nil {
		t.Fatal(err)
	}
	content, finish := "", ""
	for event := range events {
		content += event.Content
		finish += event.FinishReason
		if event.ErrorCode != "" {
			t.Fatal(event.ErrorCode)
		}
	}
	if content != "Hello" || finish != "stop" {
		t.Fatalf("stream content=%q finish=%q", content, finish)
	}
	input := upstream.ImageRequest{Model: "image", Prompt: "test", Quality: "low", Size: "1024x1024", Count: 2}
	images, err := client.GenerateImages(t.Context(), input)
	if err != nil || len(images) != 2 || string(images[0].Data) != "test-image" {
		t.Fatalf("images=%v error=%v", images, err)
	}
	for _, format := range []string{"multipart", "json"} {
		t.Run(format, func(t *testing.T) {
			client := adapter(t, mock.Configuration{APIKey: "fixture-key"}, format, time.Second)
			// Administrators may allow more than four references; the adapter forwards them all.
			references := make([]upstream.Reference, 6)
			for i := range references {
				references[i] = upstream.Reference{MIME: "image/png", Data: []byte("reference")}
			}
			results, err := client.EditImages(t.Context(), upstream.EditRequest{ImageRequest: input, References: references})
			if err != nil || len(results) != 2 {
				t.Fatalf("edit results=%v error=%v", results, err)
			}
		})
	}
}

func TestTransparentEditFields(t *testing.T) {
	for _, format := range []string{"json", "multipart"} {
		t.Run(format, func(t *testing.T) {
			fields := make(chan [3]string, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/v1/images/edits" {
					w.WriteHeader(404)
					return
				}
				var values [3]string
				r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
				if format == "json" {
					var input struct {
						Background string `json:"background"`
						Output     string `json:"output_format"`
						Format     string `json:"response_format"`
					}
					if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
						w.WriteHeader(400)
						return
					}
					values = [3]string{input.Background, input.Output, input.Format}
				} else {
					reader, err := r.MultipartReader()
					if err != nil {
						w.WriteHeader(400)
						return
					}
					for {
						part, err := reader.NextPart()
						if err == io.EOF {
							break
						}
						if err != nil {
							w.WriteHeader(400)
							return
						}
						data, readErr := io.ReadAll(io.LimitReader(part, 32))
						closeErr := part.Close()
						if readErr != nil || closeErr != nil {
							w.WriteHeader(400)
							return
						}
						switch part.FormName() {
						case "background":
							values[0] = string(data)
						case "output_format":
							values[1] = string(data)
						case "response_format":
							values[2] = string(data)
						}
					}
				}
				fields <- values
				w.Header().Set("Content-Type", "application/json")
				if _, err := io.WriteString(w, `{"data":[{"b64_json":"aW1hZ2U="}]}`); err != nil {
					t.Error(err)
				}
			}))
			t.Cleanup(server.Close)
			client, err := upstream.NewClient(upstream.Connection{BaseURL: server.URL + "/v1", APIKey: "fixture", ChatTimeout: time.Second, ImageTimeout: time.Second, EditFormat: format}, upstream.NetworkPolicy{AllowPrivate: true}, nil)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(client.Close)
			request := upstream.EditRequest{
				ImageRequest: upstream.ImageRequest{Model: "image", Prompt: "test", Quality: "low", Size: "1024x1024", Count: 1},
				References:   []upstream.Reference{{MIME: "image/png", Data: []byte("fixture")}},
			}
			for _, tc := range []struct {
				transparent bool
				output      string
				want        [3]string
			}{
				{want: [3]string{"", "", "b64_json"}},
				{transparent: true, want: [3]string{"transparent", "png", "b64_json"}},
				{output: "gif", want: [3]string{"", "gif", ""}},
			} {
				request.TransparentBackground = tc.transparent
				request.OutputFormat = tc.output
				if _, err := client.EditImages(t.Context(), request); err != nil {
					t.Fatal(err)
				}
				if got := <-fields; got != tc.want {
					t.Fatalf("fields=%v want %v", got, tc.want)
				}
			}
		})
	}
}

func TestGIFResponseEncodings(t *testing.T) {
	const encoded = "R0lGODlhBAADAIAAAP8AAAD/ACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAFAAAACwAAAAABAADAAACCgRBEARBEARBEAUAIfkEAB4AAAAsAAAAAAQAAwAAAgoMwzAMwzAMwzAFADs="
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, contentType, body string
		count                   int
		invalid                 bool
	}{
		{name: "base64", body: `{"data":[{"b64_json":"` + encoded + `"}]}`, count: 1},
		{name: "base64 data URL", body: `{"data":[{"b64_json":"data:image/gif;base64,` + encoded + `"}]}`, count: 1},
		{name: "URL data URL", body: `{"data":[{"url":"data:image/gif;base64,` + encoded + `"}]}`, count: 1},
		{name: "raw GIF", contentType: "image/gif", body: string(raw), count: 1},
		{name: "false MIME", contentType: "image/gif", body: "not an image", count: 1, invalid: true},
		{name: "ambiguous raw count", contentType: "image/gif", body: string(raw), count: 2, invalid: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request struct {
					upstream.ImageRequest
					Format string `json:"response_format"`
				}
				if r.URL.Path != "/v1/images/generations" || json.NewDecoder(r.Body).Decode(&request) != nil ||
					request.OutputFormat != "gif" || request.Format != "" || request.Size != "1024x768" || request.Count != tc.count {
					t.Error("invalid GIF generation request")
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				w.Header().Set("Content-Type", tc.contentType)
				if _, err := io.WriteString(w, tc.body); err != nil {
					t.Error(err)
				}
			}))
			t.Cleanup(server.Close)
			client, err := upstream.NewClient(upstream.Connection{BaseURL: server.URL + "/v1", APIKey: "fixture", ChatTimeout: time.Second, ImageTimeout: time.Second, EditFormat: "json"}, upstream.NetworkPolicy{AllowPrivate: true}, nil)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(client.Close)
			got, err := client.GenerateImages(t.Context(), upstream.ImageRequest{Model: "image", Prompt: "Animated cat", Size: "1024x768", Count: tc.count, OutputFormat: "gif"})
			if tc.invalid {
				if upstream.FailureCode(err) != "UPSTREAM_RESPONSE_INVALID" {
					t.Fatalf("unexpected error: %v", err)
				}
			} else if err != nil || len(got) != 1 || !bytes.Equal(got[0].Data, raw) {
				t.Fatalf("GIF response not preserved: %v", err)
			}
		})
	}
}
func TestAdapterSafeFailuresPartialResultsAndInterruptedStream(t *testing.T) {
	for _, scenario := range []struct{ mode, code string }{{"unauthorized", "UPSTREAM_AUTH_FAILED"}, {"rate_limit", "UPSTREAM_RATE_LIMITED"}, {"unavailable", "UPSTREAM_UNAVAILABLE"}, {"rejected", "UPSTREAM_REJECTED"}} {
		t.Run(scenario.mode, func(t *testing.T) {
			client := adapter(t, mock.Configuration{Mode: scenario.mode}, "multipart", time.Second)
			_, err := client.ListModels(t.Context())
			if upstream.FailureCode(err) != scenario.code || strings.Contains(err.Error(), "private-provider") {
				t.Fatalf("unsafe or wrong error: %v", err)
			}
		})
	}
	client := adapter(t, mock.Configuration{Mode: "partial"}, "multipart", time.Second)
	input := upstream.ImageRequest{Model: "image", Prompt: "test", Quality: "low", Size: "1024x1024", Count: 2}
	results, err := client.GenerateImages(t.Context(), input)
	if err != nil || len(results) != 1 {
		t.Fatalf("partial results=%v error=%v", results, err)
	}
	foreign := adapter(t, mock.Configuration{Mode: "foreign_image"}, "multipart", time.Second)
	if _, err := foreign.GenerateImages(t.Context(), input); upstream.FailureCode(err) != "UPSTREAM_IMAGE_ORIGIN" {
		t.Fatalf("foreign image accepted: %v", err)
	}
	interrupted := adapter(t, mock.Configuration{Mode: "stream_interrupted"}, "multipart", time.Second)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	events, err := interrupted.ChatStream(ctx, upstream.ChatRequest{Model: "text", Messages: []upstream.Message{{Role: "user", Content: json.RawMessage(`"Hi"`)}}})
	if err != nil {
		t.Fatal(err)
	}
	content, code := "", ""
	for event := range events {
		content += event.Content
		code += event.ErrorCode
	}
	if content != "Hello" || code != "UPSTREAM_STREAM_INTERRUPTED" {
		t.Fatalf("interrupted content=%q error=%q", content, code)
	}
	timeout := adapter(t, mock.Configuration{Delay: time.Second}, "multipart", 20*time.Millisecond)
	if _, err := timeout.ListModels(t.Context()); upstream.FailureCode(err) != "UPSTREAM_TIMEOUT" {
		t.Fatalf("timeout error=%v", err)
	}
}
