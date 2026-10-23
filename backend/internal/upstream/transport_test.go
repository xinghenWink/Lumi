package upstream

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
	"time"
)

func TestURLAndNetworkPolicy(t *testing.T) {
	for _, value := range []string{"file:///etc/passwd", "http://user:secret@host/v1", "https://host/v1?token=secret", "https://host/v1#secret", "https://host:99999", "https://host/v1\\models"} {
		if _, err := ParseURL(value); err == nil {
			t.Errorf("accepted unsafe URL %q", value)
		}
	}
	for _, value := range []string{"127.0.0.1", "::1", "::ffff:127.0.0.1", "10.0.0.2", "169.254.169.254", "100.100.100.200", "0.0.0.0", "fe80::1", "fc00::1", "198.18.0.1"} {
		if publicAddress(netip.MustParseAddr(value)) {
			t.Errorf("accepted private or reserved address %s", value)
		}
	}
	if !publicAddress(netip.MustParseAddr("8.8.8.8")) {
		t.Fatal("public address rejected")
	}
	client, err := NewHTTPClient("", time.Second, NetworkPolicy{})
	if err != nil {
		t.Fatal(err)
	}
	defer client.CloseIdleConnections()
	request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, "http://127.0.0.1:1/v1/models", nil)
	if err != nil {
		t.Fatal(err)
	}
	if response, err := client.Do(request); err == nil {
		if closeErr := response.Body.Close(); closeErr != nil {
			t.Error(closeErr)
		}
		t.Fatal("private network was contacted without permission")
	}
}

func TestRedirectNeverForwardsCredentials(t *testing.T) {
	contacted := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		contacted = true
		w.WriteHeader(http.StatusOK)
	}))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	defer source.Close()
	client, err := NewHTTPClient("", time.Second, NetworkPolicy{AllowPrivate: true})
	if err != nil {
		t.Fatal(err)
	}
	defer client.CloseIdleConnections()
	request, err := http.NewRequestWithContext(t.Context(), http.MethodGet, source.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer test-secret")
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := response.Body.Close(); err != nil {
			t.Error(err)
		}
	}()
	if response.StatusCode != 302 || contacted {
		t.Fatal("upstream redirect was followed")
	}
}
