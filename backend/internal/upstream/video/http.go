package video

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/xinghenWink/Lumi/backend/internal/upstream"
)

type wire struct {
	body    any
	path    string
	headers map[string]string
}

type protocol struct {
	create      func(Request) wire
	readPath    func(string) string
	read        func([]byte, string) (Snapshot, error)
	contentPath func(string) string
	recoverPath func(string) string
}

type client struct {
	connection Connection
	policy     upstream.NetworkPolicy
	protocol   protocol
}

func Builtins(policy upstream.NetworkPolicy) *Registry {
	direct := func(p protocol) Factory {
		return func(c Connection, profile string) (Adapter, error) {
			if profile != "" {
				return nil, fmt.Errorf("unexpected video profile")
			}
			return newClient(c, policy, p)
		}
	}
	registry := NewRegistry(map[string]Factory{
		"ark": direct(ark()), "dashscope": direct(dashScope()), "minimax_v2": direct(minimax()), "kling_new": direct(kling()),
		"openai_video": func(c Connection, profile string) (Adapter, error) {
			p, err := gateway(profile)
			if err != nil {
				return nil, err
			}
			return newClient(c, policy, p)
		},
	})
	registry.profiles = map[string][]string{"openai_video": {"doubao", "alibaba", "hailuo", "kling"}}
	return registry
}

func newClient(c Connection, p upstream.NetworkPolicy, spec protocol) (Adapter, error) {
	if _, err := upstream.ParseURL(c.BaseURL); err != nil {
		return nil, err
	}
	if c.Key == "" || strings.ContainsAny(c.Key, "\r\n") {
		return nil, fmt.Errorf("invalid video credential")
	}
	if c.Timeout <= 0 {
		c.Timeout = 60 * time.Second
	}
	if c.ProxyURL != "" {
		if _, err := upstream.ParseURL(c.ProxyURL); err != nil {
			return nil, err
		}
	}
	base := &client{connection: c, policy: p, protocol: spec}
	if spec.recoverPath != nil {
		return &recoveryClient{client: base}, nil
	}
	return base, nil
}

func validRemoteID(value string) bool {
	if len(value) < 1 || len(value) > 200 {
		return false
	}
	for _, c := range value {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '-', c == '_', c == '.':
		default:
			return false
		}
	}
	return value != "." && value != ".."
}

func (c *client) request(ctx context.Context, method, path string, body any, headers map[string]string) (result []byte, resultErr error) {
	base, err := upstream.ParseURL(c.connection.BaseURL)
	if err != nil {
		return nil, err
	}
	part, err := url.Parse(path)
	if err != nil {
		return nil, fmt.Errorf("build video endpoint: %w", err)
	}
	base.RawPath = endpointPath(base.EscapedPath(), part.EscapedPath())
	base.Path = endpointPath(base.Path, part.Path)
	base.RawQuery = part.RawQuery
	response, err := c.open(ctx, method, base, body, headers, true, c.connection.Timeout)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := response.Body.Close(); err != nil && resultErr == nil {
			resultErr = fmt.Errorf("close video response: %w", err)
		}
	}()
	data, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil || len(data) > 1<<20 {
		return nil, &Failure{Code: "UPSTREAM_RESPONSE_INVALID", Retryable: err != nil}
	}
	return data, nil
}

func endpointPath(base, path string) string {
	for _, prefix := range []string{"/api/v3", "/api/v1", "/v2", "/v1"} {
		if strings.HasSuffix(base, prefix) && strings.HasPrefix(path, prefix+"/") {
			return base + strings.TrimPrefix(path, prefix)
		}
	}
	if strings.HasSuffix(base, "/v1") && !strings.HasPrefix(path, "/v1/") {
		base = strings.TrimSuffix(base, "/v1")
	}
	return base + path
}

type responseBody struct {
	io.ReadCloser
	client *http.Client
}

func (b *responseBody) Close() error {
	defer b.client.CloseIdleConnections()
	return b.ReadCloser.Close()
}

func (c *client) open(ctx context.Context, method string, target *url.URL, body any, headers map[string]string, auth bool, timeout time.Duration) (*http.Response, error) {
	if err := c.policy.ValidateDestination(ctx, target); err != nil {
		return nil, &Failure{Code: "UPSTREAM_NETWORK_BLOCKED", Definite: true}
	}
	var raw []byte
	var err error
	if body != nil {
		raw, err = json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("encode video request: %w", err)
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, target.String(), bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("create video request: %w", err)
	}
	if auth {
		req.Header.Set("Authorization", "Bearer "+c.connection.Key)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	hc, err := upstream.NewHTTPClient(c.connection.ProxyURL, timeout, c.policy)
	if err != nil {
		return nil, fmt.Errorf("configure video transport: %w", err)
	}
	response, err := hc.Do(req)
	if err != nil {
		hc.CloseIdleConnections()
		return nil, &Failure{Code: "UPSTREAM_UNAVAILABLE", Retryable: true}
	}
	response.Body = &responseBody{ReadCloser: response.Body, client: hc}
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return response, nil
	}
	closeErr := response.Body.Close()
	status := response.StatusCode
	if closeErr != nil && status >= 500 {
		return nil, &Failure{Code: "UPSTREAM_UNAVAILABLE", Retryable: true}
	}
	switch status {
	case 401, 403:
		return nil, &Failure{Code: "UPSTREAM_AUTH_FAILED", Definite: true}
	case 429:
		return nil, &Failure{Code: "UPSTREAM_RATE_LIMITED", Definite: true, Retryable: true}
	case 400, 422:
		return nil, &Failure{Code: "UPSTREAM_REQUEST_INVALID", Definite: true}
	case 404:
		return nil, &Failure{Code: "UPSTREAM_NOT_FOUND", Definite: true}
	default:
		return nil, &Failure{Code: "UPSTREAM_UNAVAILABLE", Retryable: true}
	}
}

func (c *client) Submit(ctx context.Context, req Request) (string, error) {
	spec := c.protocol.create(req)
	raw, err := c.request(ctx, http.MethodPost, spec.path, spec.body, spec.headers)
	if err != nil {
		return "", err
	}
	task, err := c.protocol.read(raw, "")
	if err != nil {
		return "", err
	}
	if !validRemoteID(task.ID) || strings.Contains(task.ID, c.connection.Key) {
		return "", &Failure{Code: "UPSTREAM_RESPONSE_INVALID"}
	}
	return task.ID, nil
}

type recoveryClient struct{ *client }

func (c *recoveryClient) Recover(ctx context.Context, id string) (string, error) {
	if !validRemoteID(id) {
		return "", &Failure{Code: "UPSTREAM_RESPONSE_INVALID"}
	}
	raw, err := c.request(ctx, http.MethodGet, c.protocol.recoverPath(id), nil, nil)
	if err != nil {
		return "", err
	}
	task, err := c.protocol.read(raw, id)
	if err != nil {
		return "", err
	}
	if !validRemoteID(task.ID) || strings.Contains(task.ID, c.connection.Key) {
		return "", &Failure{Code: "UPSTREAM_RESPONSE_INVALID"}
	}
	return task.ID, nil
}

func (c *client) Query(ctx context.Context, id string) (Snapshot, error) {
	if !validRemoteID(id) {
		return Snapshot{}, &Failure{Code: "UPSTREAM_RESPONSE_INVALID"}
	}
	raw, err := c.request(ctx, http.MethodGet, c.protocol.readPath(id), nil, nil)
	if err != nil {
		return Snapshot{}, err
	}
	task, err := c.protocol.read(raw, id)
	if err != nil {
		return task, err
	}
	if task.ID != id || task.State == "" {
		return Snapshot{}, &Failure{Code: "UPSTREAM_RESPONSE_INVALID"}
	}
	return task, nil
}

func (c *client) Download(ctx context.Context, task Snapshot) (io.ReadCloser, error) {
	if task.State != Succeeded || !validRemoteID(task.ID) {
		return nil, &Failure{Code: "UPSTREAM_RESPONSE_INVALID"}
	}
	var target *url.URL
	var err error
	auth := c.protocol.contentPath != nil
	if auth {
		target, err = upstream.ParseURL(c.connection.BaseURL)
		if err != nil {
			return nil, err
		}
		target.Path = endpointPath(target.Path, c.protocol.contentPath(task.ID))
	} else {
		target, err = url.Parse(task.ResultURL)
		if err != nil || target.Hostname() == "" || target.User != nil || target.Fragment != "" ||
			(target.Scheme != "https" && (!c.policy.AllowPrivate || target.Scheme != "http")) {
			return nil, &Failure{Code: "UPSTREAM_RESPONSE_INVALID"}
		}
	}
	response, err := c.open(ctx, http.MethodGet, target, nil, nil, auth, 5*time.Minute)
	if err != nil {
		return nil, err
	}
	return response.Body, nil
}

func parse(raw []byte, v any) error {
	if err := json.Unmarshal(raw, v); err != nil {
		return &Failure{Code: "UPSTREAM_RESPONSE_INVALID"}
	}
	return nil
}

func state(value string) State {
	switch strings.ToLower(value) {
	case "pending", "queued", "submitted", "not_start":
		return Queued
	case "running", "processing", "in_progress":
		return Running
	case "succeeded", "succeed", "success", "completed":
		return Succeeded
	case "failed", "failure", "expired", "canceled", "cancelled":
		return Failed
	default:
		return ""
	}
}

func Prompt(req Request, alias func(Role, int) string) string {
	counts := make(map[Role]int)
	aliases := make(map[string]string)
	for _, ref := range req.References {
		role := ref.Role
		counts[role]++
		if ref.Token != "" {
			aliases[ref.Token] = alias(role, counts[role])
		}
	}
	return regexp.MustCompile(`@\[[a-zA-Z0-9_-]{1,50}\]`).ReplaceAllStringFunc(req.Prompt, func(token string) string {
		if result, ok := aliases[token]; ok {
			return result
		}
		return token
	})
}

func IsDefinite(err error) bool {
	var failure *Failure
	return errors.As(err, &failure) && failure.Definite
}
