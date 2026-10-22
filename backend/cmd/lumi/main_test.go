package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealthcheck(t *testing.T) {
	for _, status := range []int{http.StatusOK, http.StatusServiceUnavailable, http.StatusFound} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/healthz" {
					t.Errorf("path = %s", r.URL.Path)
				}
				w.Header().Set("Location", "https://example.invalid")
				w.WriteHeader(status)
			}))
			defer server.Close()
			err := healthcheck(t.Context(), strings.TrimPrefix(server.URL, "http://"))
			if (err == nil) != (status == http.StatusOK) {
				t.Errorf("status=%d error=%v", status, err)
			}
		})
	}
	for _, address := range []string{"bad-address", ":http", ":0", ":65536"} {
		if err := healthcheck(t.Context(), address); err == nil {
			t.Errorf("accepted invalid address %q", address)
		}
	}
}
