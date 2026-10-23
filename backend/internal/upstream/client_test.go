package upstream_test

import (
	"context"
	"encoding/json"
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
			results, err := client.EditImages(t.Context(), upstream.EditRequest{ImageRequest: input, References: []upstream.Reference{{MIME: "image/png", Data: []byte("reference")}}})
			if err != nil || len(results) != 2 {
				t.Fatalf("edit results=%v error=%v", results, err)
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
