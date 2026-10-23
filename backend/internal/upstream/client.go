package upstream

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Adapter isolates the candidate wire protocol; instance compatibility needs a probe.
type Adapter interface {
	ListModels(context.Context) ([]RemoteModel, error)
	ChatStream(context.Context, ChatRequest) (<-chan ChatEvent, error)
	GenerateImages(context.Context, ImageRequest) ([]ImageResult, error)
	EditImages(context.Context, EditRequest) ([]ImageResult, error)
}
type Connection struct {
	BaseURL, APIKey, ProxyURL, EditFormat string
	ChatTimeout, ImageTimeout             time.Duration
}
type RemoteModel struct {
	ID string `json:"id"`
}
type Message struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}
type ChatRequest struct {
	Model    string    `json:"model"`
	Messages []Message `json:"messages"`
}
type ChatEvent struct {
	Content, FinishReason, ErrorCode string
	Usage                            json.RawMessage
}
type ImageRequest struct {
	Model   string `json:"model"`
	Prompt  string `json:"prompt"`
	Quality string `json:"quality"`
	Size    string `json:"size"`
	Count   int    `json:"n"`
}
type Reference struct {
	Name, MIME string
	Data       []byte
}
type EditRequest struct {
	ImageRequest
	References []Reference
}
type ImageResult struct {
	Data          []byte
	URL           string
	RevisedPrompt string
}
type Call struct {
	Model, Kind, ErrorCode string
	Status                 int
	LatencyMS              int64
}
type Failure struct {
	Code       string
	Status     int
	RetryAfter int
}

func (e *Failure) Error() string { return e.Code }

type Client struct {
	connection Connection
	base       *url.URL
	policy     NetworkPolicy
	chat       *http.Client
	image      *http.Client
	observer   func(context.Context, Call)
}

func NewClient(connection Connection, policy NetworkPolicy, observer func(context.Context, Call)) (*Client, error) {
	base, err := ParseURL(connection.BaseURL)
	if err != nil || strings.TrimSpace(connection.APIKey) == "" || strings.ContainsAny(connection.APIKey, "\r\n") {
		return nil, fmt.Errorf("invalid upstream connection")
	}
	if connection.ChatTimeout <= 0 || connection.ChatTimeout > 10*time.Minute || connection.ImageTimeout <= 0 || connection.ImageTimeout > 10*time.Minute || (connection.EditFormat != "multipart" && connection.EditFormat != "json") {
		return nil, fmt.Errorf("invalid upstream protocol settings")
	}
	chat, err := NewHTTPClient(connection.ProxyURL, connection.ChatTimeout, policy)
	if err != nil {
		return nil, err
	}
	image, err := NewHTTPClient(connection.ProxyURL, connection.ImageTimeout, policy)
	if err != nil {
		chat.CloseIdleConnections()
		return nil, err
	}
	return &Client{connection: connection, base: base, policy: policy, chat: chat, image: image, observer: observer}, nil
}
func (c *Client) Close() { c.chat.CloseIdleConnections(); c.image.CloseIdleConnections() }
func FailureCode(err error) string {
	if err == nil {
		return ""
	}
	var failure *Failure
	if errors.As(err, &failure) {
		return failure.Code
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "UPSTREAM_TIMEOUT"
	}
	return "UPSTREAM_UNAVAILABLE"
}
func (c *Client) observe(ctx context.Context, kind, model string, start time.Time, status int, err error) {
	if c.observer != nil {
		c.observer(ctx, Call{Model: model, Kind: kind, Status: status, LatencyMS: time.Since(start).Milliseconds(), ErrorCode: FailureCode(err)})
	}
}
func (c *Client) open(ctx context.Context, image bool, method, path, contentType string, body io.Reader) (*http.Response, error) {
	target := *c.base
	target.Path += path
	if err := c.policy.ValidateDestination(ctx, &target); err != nil {
		return nil, &Failure{Code: "UPSTREAM_NETWORK_BLOCKED"}
	}
	request, err := http.NewRequestWithContext(ctx, method, target.String(), body)
	if err != nil {
		return nil, fmt.Errorf("create upstream request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+c.connection.APIKey)
	request.Header.Set("Accept", "application/json")
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	client := c.chat
	if image {
		client = c.image
	}
	response, err := client.Do(request)
	if err != nil {
		code := "UPSTREAM_UNAVAILABLE"
		if errors.Is(err, context.DeadlineExceeded) {
			code = "UPSTREAM_TIMEOUT"
		}
		if errors.Is(ctx.Err(), context.Canceled) {
			code = "UPSTREAM_CANCELED"
		}
		return nil, &Failure{Code: code}
	}
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return response, nil
	}
	code := "UPSTREAM_UNAVAILABLE"
	switch response.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		code = "UPSTREAM_AUTH_FAILED"
	case http.StatusTooManyRequests:
		code = "UPSTREAM_RATE_LIMITED"
	case http.StatusBadRequest, http.StatusUnprocessableEntity:
		code = "UPSTREAM_REQUEST_INVALID"
		var rejected struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if json.NewDecoder(io.LimitReader(response.Body, 8192)).Decode(&rejected) == nil && (rejected.Error.Code == "content_policy_violation" || rejected.Error.Code == "content_filter") {
			code = "UPSTREAM_REJECTED"
		}
	}
	retry, retryErr := strconv.Atoi(response.Header.Get("Retry-After"))
	if retryErr != nil || retry < 0 || retry > 3600 {
		retry = 0
	}
	failure := &Failure{Code: code, Status: response.StatusCode, RetryAfter: retry}
	if err := response.Body.Close(); err != nil {
		return nil, fmt.Errorf("close rejected upstream response: %w", failure)
	}
	return nil, failure
}
func responseStatus(response *http.Response, err error) int {
	if response != nil {
		return response.StatusCode
	}
	var failure *Failure
	if errors.As(err, &failure) {
		return failure.Status
	}
	return 0
}
func closeBody(response *http.Response, result *error) {
	if err := response.Body.Close(); err != nil && *result == nil {
		*result = &Failure{Code: "UPSTREAM_RESPONSE_INVALID", Status: response.StatusCode}
	}
}
func decodeBody(response *http.Response, target any, maximum int64) error {
	body, err := io.ReadAll(io.LimitReader(response.Body, maximum+1))
	if err != nil || int64(len(body)) > maximum || json.Unmarshal(body, target) != nil {
		return &Failure{Code: "UPSTREAM_RESPONSE_INVALID", Status: response.StatusCode}
	}
	return nil
}
func validRemoteName(value string) bool {
	return len(value) >= 1 && len(value) <= 200 && !strings.ContainsAny(value, "\r\n\x00")
}
func (c *Client) ListModels(ctx context.Context) (models []RemoteModel, result error) {
	start := time.Now()
	response, err := c.open(ctx, false, http.MethodGet, "/models", "", nil)
	defer func() { c.observe(ctx, "models", "", start, responseStatus(response, err), result) }()
	if err != nil {
		return nil, err
	}
	defer closeBody(response, &result)
	var body struct {
		Data []RemoteModel `json:"data"`
	}
	if err := decodeBody(response, &body, 2<<20); err != nil {
		return nil, err
	}
	if body.Data == nil || len(body.Data) > 1000 {
		return nil, &Failure{Code: "UPSTREAM_RESPONSE_INVALID", Status: response.StatusCode}
	}
	seen := make(map[string]bool)
	models = make([]RemoteModel, 0, len(body.Data))
	for _, model := range body.Data {
		if !validRemoteName(model.ID) || strings.Contains(model.ID, c.connection.APIKey) {
			return nil, &Failure{Code: "UPSTREAM_RESPONSE_INVALID"}
		}
		if !seen[model.ID] {
			models = append(models, model)
			seen[model.ID] = true
		}
	}
	return models, nil
}
func validImage(input ImageRequest) bool {
	return validRemoteName(input.Model) && len(input.Prompt) > 0 && len(input.Prompt) <= 64000 && input.Count >= 1 && input.Count <= 10 && len(input.Size) <= 40 && len(input.Quality) <= 40
}
func (c *Client) imageResults(response *http.Response, count int) ([]ImageResult, error) {
	var body struct {
		Data []struct {
			Base64        string `json:"b64_json"`
			URL           string `json:"url"`
			RevisedPrompt string `json:"revised_prompt"`
		} `json:"data"`
	}
	if err := decodeBody(response, &body, 32<<20); err != nil {
		return nil, err
	}
	if len(body.Data) == 0 || len(body.Data) > count {
		return nil, &Failure{Code: "UPSTREAM_RESPONSE_INVALID"}
	}
	results := make([]ImageResult, 0, len(body.Data))
	for _, item := range body.Data {
		result := ImageResult{RevisedPrompt: item.RevisedPrompt}
		if item.Base64 != "" {
			raw, err := base64.StdEncoding.Strict().DecodeString(item.Base64)
			if err != nil || len(raw) == 0 || len(raw) > 20<<20 {
				return nil, &Failure{Code: "UPSTREAM_RESPONSE_INVALID"}
			}
			result.Data = raw
		} else {
			target, err := url.Parse(item.URL)
			if err != nil || target.User != nil || target.Fragment != "" || !strings.EqualFold(target.Scheme, c.base.Scheme) || !strings.EqualFold(target.Host, c.base.Host) {
				return nil, &Failure{Code: "UPSTREAM_IMAGE_ORIGIN"}
			}
			result.URL = target.String()
		}
		results = append(results, result)
	}
	return results, nil
}
func (c *Client) GenerateImages(ctx context.Context, input ImageRequest) (results []ImageResult, result error) {
	if !validImage(input) {
		return nil, &Failure{Code: "UPSTREAM_REQUEST_INVALID"}
	}
	body, err := json.Marshal(struct {
		ImageRequest
		ResponseFormat string `json:"response_format"`
	}{input, "b64_json"})
	if err != nil {
		return nil, fmt.Errorf("encode generation request: %w", err)
	}
	start := time.Now()
	response, err := c.open(ctx, true, http.MethodPost, "/images/generations", "application/json", bytes.NewReader(body))
	defer func() { c.observe(ctx, "generate", input.Model, start, responseStatus(response, err), result) }()
	if err != nil {
		return nil, err
	}
	defer closeBody(response, &result)
	return c.imageResults(response, input.Count)
}
func (c *Client) EditImages(ctx context.Context, input EditRequest) (results []ImageResult, result error) {
	if !validImage(input.ImageRequest) || len(input.References) < 1 || len(input.References) > 4 {
		return nil, &Failure{Code: "UPSTREAM_REQUEST_INVALID"}
	}
	for _, reference := range input.References {
		if len(reference.Data) == 0 || len(reference.Data) > 10<<20 || (reference.MIME != "image/png" && reference.MIME != "image/jpeg" && reference.MIME != "image/webp") {
			return nil, &Failure{Code: "UPSTREAM_REQUEST_INVALID"}
		}
	}
	var body bytes.Buffer
	contentType := "application/json"
	if c.connection.EditFormat == "json" {
		images := make([]map[string]string, 0, len(input.References))
		for _, reference := range input.References {
			images = append(images, map[string]string{"image_url": "data:" + reference.MIME + ";base64," + base64.StdEncoding.EncodeToString(reference.Data)})
		}
		if err := json.NewEncoder(&body).Encode(struct {
			ImageRequest
			Images []map[string]string `json:"images"`
			Format string              `json:"response_format"`
		}{input.ImageRequest, images, "b64_json"}); err != nil {
			return nil, fmt.Errorf("encode edit request: %w", err)
		}
	} else {
		writer := multipart.NewWriter(&body)
		for name, value := range map[string]string{"model": input.Model, "prompt": input.Prompt, "quality": input.Quality, "size": input.Size, "n": strconv.Itoa(input.Count), "response_format": "b64_json"} {
			if err := writer.WriteField(name, value); err != nil {
				return nil, fmt.Errorf("encode edit field: %w", err)
			}
		}
		for index, reference := range input.References {
			field := "image"
			if len(input.References) > 1 {
				field = "image[]"
			}
			extension := ".png"
			switch reference.MIME {
			case "image/jpeg":
				extension = ".jpg"
			case "image/webp":
				extension = ".webp"
			}
			header := make(textproto.MIMEHeader)
			header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{"name": field, "filename": fmt.Sprintf("reference-%d%s", index, extension)}))
			header.Set("Content-Type", reference.MIME)
			part, err := writer.CreatePart(header)
			if err != nil {
				return nil, fmt.Errorf("create edit part: %w", err)
			}
			if _, err := part.Write(reference.Data); err != nil {
				return nil, fmt.Errorf("write edit part: %w", err)
			}
		}
		if err := writer.Close(); err != nil {
			return nil, fmt.Errorf("finish edit request: %w", err)
		}
		contentType = writer.FormDataContentType()
	}
	start := time.Now()
	response, err := c.open(ctx, true, http.MethodPost, "/images/edits", contentType, &body)
	defer func() { c.observe(ctx, "edit", input.Model, start, responseStatus(response, err), result) }()
	if err != nil {
		return nil, err
	}
	defer closeBody(response, &result)
	return c.imageResults(response, input.Count)
}
