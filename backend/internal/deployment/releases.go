package deployment

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	githubAPI     = "https://api.github.com/repos/" + Repository + "/releases"
	releaseURL    = "https://github.com/" + Repository + "/releases"
	pageSize      = 15
	maxPage       = 100
	cacheTTL      = 5 * time.Minute
	retryInterval = 30 * time.Second
	maxResponse   = 2 << 20
)

var errNoManifest = errors.New("release has no verified deployment manifest")

type Asset struct {
	Name   string `json:"name"`
	Digest string `json:"digest"`
}

type Release struct {
	Version     string    `json:"tag_name"`
	Name        string    `json:"name"`
	Notes       string    `json:"body"`
	PublishedAt time.Time `json:"published_at"`
	Draft       bool      `json:"draft"`
	Prerelease  bool      `json:"prerelease"`
	Assets      []Asset   `json:"assets"`
}

func (r Release) stable() bool {
	return Stable(r.Version) && !r.Draft && !r.Prerelease && !r.PublishedAt.IsZero()
}

type cachedResponse struct {
	body      []byte
	etag      string
	checked   time.Time
	attempted time.Time
	next      time.Time
	stale     bool
	more      bool
}

type Releases struct {
	client    *http.Client
	mu        sync.Mutex
	cache     map[string]cachedResponse
	rateReset time.Time
	now       func() time.Time
}

func NewReleases() *Releases {
	return &Releases{
		client: &http.Client{Timeout: 5 * time.Second, CheckRedirect: releaseRedirect},
		cache:  make(map[string]cachedResponse),
		now:    time.Now,
	}
}

func releaseRedirect(req *http.Request, via []*http.Request) error {
	if len(via) == 0 || len(via) > 4 || req.URL.Scheme != "https" || req.URL.User != nil || req.URL.Port() != "" {
		return fmt.Errorf("invalid release redirect")
	}
	switch req.URL.Hostname() {
	case "release-assets.githubusercontent.com", "objects.githubusercontent.com":
		if via[0].URL.Hostname() == "github.com" {
			return nil
		}
	}
	return fmt.Errorf("unexpected release redirect")
}

func (s *Releases) fetch(ctx context.Context, endpoint string, refresh bool) (cachedResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := s.cache[endpoint]
	now := s.now()
	if wait := entry.next; now.Before(wait) && (!refresh || entry.stale || now.Sub(entry.attempted) < retryInterval) {
		return cachedResult(entry)
	}
	if now.Before(s.rateReset) {
		entry.stale = true
		return cachedResult(entry)
	}
	if len(s.cache) >= 256 {
		for key, candidate := range s.cache {
			if now.Sub(candidate.attempted) > cacheTTL && key != endpoint {
				delete(s.cache, key)
			}
		}
	}
	if len(s.cache) >= 256 && entry.attempted.IsZero() {
		return cachedResponse{}, fmt.Errorf("release cache is full")
	}

	entry.attempted = now
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return cachedResponse{}, fmt.Errorf("build release request: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "Lumi-release-manager")
	if req.URL.Host == "api.github.com" {
		req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	}
	if entry.etag != "" {
		req.Header.Set("If-None-Match", entry.etag)
	}
	response, err := s.client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return cachedResponse{}, fmt.Errorf("fetch release: %w", ctx.Err())
		}
		return s.markUnavailable(endpoint, entry)
	}
	defer response.Body.Close() //nolint:errcheck // A completed or discarded HTTP read cannot be changed by Close.
	switch response.StatusCode {
	case http.StatusNotModified:
		if entry.body == nil {
			return s.markUnavailable(endpoint, entry)
		}
	case http.StatusOK:
		body, readErr := io.ReadAll(io.LimitReader(response.Body, maxResponse+1))
		if readErr != nil || len(body) > maxResponse || !json.Valid(body) {
			return s.markUnavailable(endpoint, entry)
		}
		entry.body = body
		entry.etag = response.Header.Get("ETag")
		entry.more = strings.Contains(response.Header.Get("Link"), `rel="next"`)
	default:
		if response.StatusCode == http.StatusTooManyRequests || response.StatusCode == http.StatusForbidden {
			s.rateReset = rateReset(now, response.Header)
		}
		return s.markUnavailable(endpoint, entry)
	}
	entry.checked, entry.next, entry.stale = now, now.Add(cacheTTL), false
	s.cache[endpoint] = entry
	return entry, nil
}

func rateReset(now time.Time, header http.Header) time.Time {
	reset := now.Add(retryInterval)
	if seconds, err := strconv.ParseInt(header.Get("Retry-After"), 10, 64); err == nil && seconds > 0 {
		reset = now.Add(time.Duration(min(seconds, 7200)) * time.Second)
	}
	if header.Get("X-RateLimit-Remaining") == "0" {
		if unix, err := strconv.ParseInt(header.Get("X-RateLimit-Reset"), 10, 64); err == nil {
			candidate := time.Unix(unix, 0)
			if candidate.After(reset) && candidate.Before(now.Add(2*time.Hour)) {
				reset = candidate
			}
		}
	}
	return reset
}

func (s *Releases) markUnavailable(endpoint string, entry cachedResponse) (cachedResponse, error) {
	entry.next = entry.attempted.Add(retryInterval)
	entry.stale = true
	s.cache[endpoint] = entry
	return cachedResult(entry)
}

func cachedResult(entry cachedResponse) (cachedResponse, error) {
	if entry.body == nil {
		return entry, fmt.Errorf("release service unavailable")
	}
	return entry, nil
}

func (s *Releases) latest(ctx context.Context, refresh bool) (Release, cachedResponse, error) {
	return s.get(ctx, githubAPI+"/latest", refresh)
}

func (s *Releases) get(ctx context.Context, endpoint string, refresh bool) (Release, cachedResponse, error) {
	entry, err := s.fetch(ctx, endpoint, refresh)
	if err != nil {
		return Release{}, entry, err
	}
	var r Release
	if err := json.Unmarshal(entry.body, &r); err != nil {
		return Release{}, entry, fmt.Errorf("decode release: %w", err)
	}
	if !r.stable() {
		return Release{}, entry, fmt.Errorf("expected a published stable release")
	}
	return r, entry, nil
}

func (s *Releases) list(ctx context.Context, page int, refresh bool) ([]Release, cachedResponse, error) {
	entry, err := s.fetch(ctx, fmt.Sprintf("%s?per_page=%d&page=%d", githubAPI, pageSize, page), refresh)
	if err != nil {
		return nil, entry, err
	}
	var all []Release
	if err := json.Unmarshal(entry.body, &all); err != nil {
		return nil, entry, fmt.Errorf("decode release list: %w", err)
	}
	releases := make([]Release, 0, len(all))
	for _, r := range all {
		if r.stable() {
			releases = append(releases, r)
		}
	}
	return releases, entry, nil
}

func (s *Releases) manifest(ctx context.Context, tag string) (Manifest, error) {
	if !Stable(tag) {
		return Manifest{}, errNoManifest
	}
	r, entry, err := s.get(ctx, githubAPI+"/tags/"+url.PathEscape(tag), false)
	if err != nil {
		return Manifest{}, err
	}
	if entry.stale || r.Version != tag {
		return Manifest{}, errNoManifest
	}
	return s.releaseManifest(ctx, r)
}

func (s *Releases) releaseManifest(ctx context.Context, release Release) (Manifest, error) {
	if !release.stable() {
		return Manifest{}, errNoManifest
	}
	for _, asset := range release.Assets {
		if asset.Name != ManifestName || !ValidDigest(asset.Digest) {
			continue
		}
		entry, err := s.fetch(ctx, releaseURL+"/download/"+release.Version+"/"+ManifestName, false)
		if err != nil {
			return Manifest{}, err
		}
		if entry.stale || fmt.Sprintf("sha256:%x", sha256.Sum256(entry.body)) != asset.Digest {
			return Manifest{}, errNoManifest
		}
		var manifest Manifest
		if err := json.Unmarshal(entry.body, &manifest); err != nil {
			return Manifest{}, fmt.Errorf("decode manifest: %w", err)
		}
		if err := manifest.Validate(release.Version); err != nil {
			return Manifest{}, err
		}
		return manifest, nil
	}
	return Manifest{}, errNoManifest
}
