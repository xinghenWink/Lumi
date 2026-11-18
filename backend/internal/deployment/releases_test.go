package deployment

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
)

type httpFunc func(*http.Request) (*http.Response, error)

func (f httpFunc) RoundTrip(request *http.Request) (*http.Response, error) { return f(request) }

func response(code int, header http.Header, body string) *http.Response {
	return &http.Response{StatusCode: code, Header: header, Body: io.NopCloser(strings.NewReader(body))}
}

func TestReleaseCacheRefreshAndLimit(t *testing.T) {
	const stable = `{"tag_name":"v0.4.0","published_at":"2026-11-16T00:00:00Z"}`
	clock := time.Date(2026, 11, 16, 12, 0, 0, 0, time.UTC)
	client := NewReleases()
	client.now = func() time.Time { return clock }
	calls := 0
	client.client.Transport = httpFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.String() != githubAPI+"/latest" {
			t.Fatalf("unexpected remote request %s", r.URL)
		}
		switch calls {
		case 1:
			return response(200, http.Header{"Etag": []string{`"lumi"`}}, stable), nil
		case 2:
			if r.Header.Get("If-None-Match") != `"lumi"` {
				t.Fatal("cache missed conditional request")
			}
			return response(304, nil, ""), nil
		default:
			return response(429, http.Header{"Retry-After": []string{"120"}}, ""), nil
		}
	})
	get := func(force, stale bool) {
		t.Helper()
		result, metadata, err := client.latest(t.Context(), force)
		if err != nil || result.Version != "v0.4.0" || metadata.stale != stale {
			t.Fatalf("unexpected cached release %+v %+v %v", result, metadata, err)
		}
	}
	get(false, false)
	get(true, false)
	if calls != 1 {
		t.Fatal("refresh throttling failed")
	}
	clock = clock.Add(31 * time.Second)
	get(true, false)
	clock = clock.Add(31 * time.Second)
	get(true, true)
	clock = clock.Add(35 * time.Second)
	get(true, true)
	if calls != 3 {
		t.Fatal("rate limit did not preserve cache")
	}
}

func TestOnlyStableReleasesAndVerifiedAssets(t *testing.T) {
	client := NewReleases()
	manifest := fixturePlan().Target
	encoded, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	release := Release{Version: manifest.Version, PublishedAt: time.Now(),
		Assets: []Asset{{Name: ManifestName, Digest: fmt.Sprintf("sha256:%x", sha256.Sum256(encoded))}}}
	client.client.Transport = httpFunc(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Hostname() {
		case "api.github.com":
			return response(200, nil, `[
				{"tag_name":"v0.5.0","published_at":"2026-11-16T00:00:00Z"},
				{"tag_name":"v0.4.9","draft":true,"published_at":"2026-11-15T00:00:00Z"},
				{"tag_name":"v0.4.8","prerelease":true,"published_at":"2026-11-14T00:00:00Z"},
				{"tag_name":"edge","published_at":"2026-11-15T00:00:00Z"}]`), nil
		case "github.com":
			return response(200, nil, string(encoded)), nil
		default:
			t.Fatalf("unexpected remote host %s", r.URL)
			return nil, nil
		}
	})
	items, _, err := client.list(t.Context(), 1, false)
	if err != nil || len(items) != 1 || items[0].Version != manifest.Version {
		t.Fatalf("incorrect filtered releases %+v %v", items, err)
	}
	if verified, err := client.releaseManifest(t.Context(), release); err != nil || verified.Digest != manifest.Digest {
		t.Fatalf("valid asset rejected: %v", err)
	}
	release.Assets[0].Digest = "sha256:" + strings.Repeat("0", 64)
	if _, err := client.releaseManifest(t.Context(), release); err == nil {
		t.Fatal("incorrect asset digest accepted")
	}
}

func TestAnnouncementReleasesUseReleaseCacheAndOnlyListPublishedStableVersions(t *testing.T) {
	clock := time.Date(2026, 11, 16, 12, 0, 0, 0, time.UTC)
	client := NewReleases()
	client.now = func() time.Time { return clock }
	service := &Service{releases: client}
	calls := 0
	client.client.Transport = httpFunc(func(request *http.Request) (*http.Response, error) {
		calls++
		if request.URL.Host != "api.github.com" || request.URL.Path != "/repos/"+Repository+"/releases" || request.URL.Query().Get("per_page") != "15" {
			t.Fatalf("unexpected request: %s", request.URL)
		}
		switch calls {
		case 1:
			if request.URL.Query().Get("page") != "1" {
				t.Fatalf("first page request: %s", request.URL)
			}
			return response(http.StatusOK, http.Header{"Link": []string{`<https://api.github.com/?page=2>; rel="next"`}}, `[
				{"tag_name":"v0.5.0","name":"Updates","body":"## Changes\n\n- New feature","published_at":"2026-11-16T00:00:00Z"},
				{"tag_name":"v0.4.9","draft":true,"published_at":"2026-11-15T00:00:00Z"},
				{"tag_name":"v0.4.8","prerelease":true,"published_at":"2026-11-14T00:00:00Z"},
				{"tag_name":"v0.4.7"}]`), nil
		case 2:
			if request.URL.Query().Get("page") != "2" {
				t.Fatalf("second page request: %s", request.URL)
			}
			return response(http.StatusOK, nil, `[]`), nil
		default:
			return response(http.StatusTooManyRequests, nil, ""), nil
		}
	})
	first, err := service.AnnouncementReleases(t.Context(), 1, true)
	if err != nil || first.Stale || first.NextPage != 2 || len(first.Items) != 1 || first.Items[0].Version != "v0.5.0" || first.Items[0].Notes != "## Changes\n\n- New feature" {
		t.Fatalf("first release page: %+v, %v", first, err)
	}
	second, err := service.AnnouncementReleases(t.Context(), first.NextPage, false)
	if err != nil || second.Stale || second.NextPage != 0 || second.Items == nil || len(second.Items) != 0 {
		t.Fatalf("second release page: %+v, %v", second, err)
	}
	clock = clock.Add(cacheTTL + time.Second)
	stale, err := service.AnnouncementReleases(t.Context(), 1, false)
	if err != nil || !stale.Stale || stale.NextPage != 2 || len(stale.Items) != 1 || stale.Items[0] != first.Items[0] {
		t.Fatalf("cached release page: %+v, %v", stale, err)
	}
	_, err = service.AnnouncementReleases(t.Context(), 3, true)
	var rejected *problem.Error
	if !errors.As(err, &rejected) || rejected.Code != "ANNOUNCEMENT_GITHUB_UNAVAILABLE" || rejected.Status != http.StatusServiceUnavailable || calls != 3 {
		t.Fatalf("uncached release page: %v, remote calls: %d", err, calls)
	}
}
