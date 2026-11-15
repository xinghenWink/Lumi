package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDeploymentGateHoldsTrafficUntilVerificationCompletes(t *testing.T) {
	gate := &deploymentGate{}
	handler := gate.wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }))
	for _, path := range []string{"/healthz", "/readyz", "/api/version", "/api/v1/me", "/"} {
		record := httptest.NewRecorder()
		handler.ServeHTTP(record, httptest.NewRequest(http.MethodGet, path, nil))
		want := http.StatusOK
		if path == "/" || path == "/api/v1/me" {
			want = http.StatusServiceUnavailable
		}
		if record.Code != want {
			t.Fatalf("%s returned %d, want %d", path, record.Code, want)
		}
	}
	gate.open.Store(true)
	record := httptest.NewRecorder()
	handler.ServeHTTP(record, httptest.NewRequest(http.MethodPost, "/api/v1/admin/system/deployment-jobs", nil))
	if record.Code != http.StatusOK {
		t.Fatalf("traffic did not resume: %d", record.Code)
	}
}
