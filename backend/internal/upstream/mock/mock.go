// Package mock supplies deterministic protocol fixtures, not claims about an actual instance.
package mock

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"time"
)

type Configuration struct {
	Mode   string
	APIKey string
	Models []string
	Delay  time.Duration
}

func New(configuration Configuration) *httptest.Server {
	return httptest.NewServer(Handler(configuration))
}
func Handler(configuration Configuration) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if configuration.Delay > 0 {
			timer := time.NewTimer(configuration.Delay)
			defer timer.Stop()
			select {
			case <-timer.C:
			case <-r.Context().Done():
				return
			}
		}
		if configuration.APIKey != "" && r.Header.Get("Authorization") != "Bearer "+configuration.APIKey {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		status := 0
		switch configuration.Mode {
		case "rate_limit":
			status = 429
			w.Header().Set("Retry-After", "12")
		case "unavailable":
			status = 503
		case "unauthorized":
			status = 401
		case "rejected":
			status = 400
		}
		if status != 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			writeJSON(w, map[string]any{"error": map[string]string{"code": "content_policy_violation", "message": "private-provider-diagnostic"}})
			return
		}
		switch r.URL.Path {
		case "/v1/models":
			items := make([]map[string]string, 0, len(configuration.Models))
			for _, id := range configuration.Models {
				items = append(items, map[string]string{"id": id})
			}
			writeJSON(w, map[string]any{"data": items})
		case "/v1/chat/completions":
			w.Header().Set("Content-Type", "text/event-stream")
			if _, err := fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n"); err != nil {
				return
			}
			if configuration.Mode == "stream_interrupted" {
				return
			}
			if _, err := fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"); err != nil {
				return
			}
		case "/v1/images/generations", "/v1/images/edits":
			item := map[string]string{"b64_json": base64.StdEncoding.EncodeToString([]byte("test-image"))}
			if configuration.Mode == "foreign_image" {
				item = map[string]string{"url": "https://foreign.invalid/image.png"}
			}
			items := []map[string]string{item}
			if configuration.Mode != "partial" {
				items = append(items, item)
			}
			writeJSON(w, map[string]any{"data": items})
		default:
			http.NotFound(w, r)
		}
	})
}
func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(value); err != nil {
		return
	}
}
