package probe

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/xinghenWink/Lumi/backend/internal/upstream"
)

type Options struct {
	BaseURL, APIKey, ChatModel, ImageModel string
	Quality, Size, EditFormat              string
	Count                                  int
	Images, Edit, Vision                   bool
	Policy                                 upstream.NetworkPolicy
}

type Observation struct {
	Operation    string   `json:"operation"`
	Path         string   `json:"path"`
	Status       int      `json:"status"`
	Milliseconds int64    `json:"latency_ms"`
	ContentType  string   `json:"content_type,omitempty"`
	Error        string   `json:"error_code,omitempty"`
	Models       []string `json:"models,omitempty"`
	ChunkFields  []string `json:"chunk_fields,omitempty"`
	Chunks       int      `json:"chunks,omitempty"`
	Done         bool     `json:"done,omitempty"`
	Results      int      `json:"results,omitempty"`
	Formats      []string `json:"formats,omitempty"`
}
type Report struct {
	Version      int           `json:"version"`
	ObservedAt   time.Time     `json:"observed_at"`
	ChatModel    string        `json:"chat_model,omitempty"`
	ImageModel   string        `json:"image_model,omitempty"`
	Quality      string        `json:"quality,omitempty"`
	Size         string        `json:"size,omitempty"`
	Count        int           `json:"count,omitempty"`
	EditFormat   string        `json:"edit_format,omitempty"`
	Observations []Observation `json:"observations"`
}

func Run(ctx context.Context, options Options) (Report, error) {
	base, err := upstream.ParseURL(options.BaseURL)
	if err != nil || strings.TrimSpace(options.APIKey) == "" || strings.ContainsAny(options.APIKey, "\r\n") {
		return Report{}, fmt.Errorf("configure a valid upstream URL and API key")
	}
	if options.Count < 1 || options.Count > 4 || (options.EditFormat != "multipart" && options.EditFormat != "json") {
		return Report{}, fmt.Errorf("invalid probe count or edit format")
	}
	if (options.Images || options.Edit) && options.ImageModel == "" {
		return Report{}, fmt.Errorf("image probing requires an explicit image model")
	}
	if options.Vision && options.ChatModel == "" {
		return Report{}, fmt.Errorf("vision probing requires an explicit chat model")
	}
	client, err := upstream.NewHTTPClient("", 180*time.Second, options.Policy)
	if err != nil {
		return Report{}, err
	}
	defer client.CloseIdleConnections()
	report := Report{Version: 1, ObservedAt: time.Now().UTC(), ChatModel: options.ChatModel, ImageModel: options.ImageModel, Quality: options.Quality, Size: options.Size, Count: options.Count, EditFormat: options.EditFormat}
	request := func(kind, method, path, contentType string, payload []byte, stream bool) {
		report.Observations = append(report.Observations, observe(ctx, client, options, base, kind, method, path, contentType, payload, stream))
	}
	request("models", http.MethodGet, "/models", "", nil, false)
	if options.ChatModel != "" {
		messages := []map[string]any{{"role": "system", "content": "Reply briefly. This is a protocol connectivity check."}, {"role": "user", "content": "Reply with OK."}}
		payload, err := json.Marshal(map[string]any{"model": options.ChatModel, "messages": messages, "stream": true})
		if err != nil {
			return report, fmt.Errorf("encode chat probe: %w", err)
		}
		request("chat_system_stream", http.MethodPost, "/chat/completions", "application/json", payload, true)
	}
	if options.Images {
		payload, err := json.Marshal(map[string]any{"model": options.ImageModel, "prompt": "A simple blue circle on a white background, no text.", "quality": options.Quality, "size": options.Size, "n": options.Count, "response_format": "b64_json"})
		if err != nil {
			return report, fmt.Errorf("encode image probe: %w", err)
		}
		request("image_generate", http.MethodPost, "/images/generations", "application/json", payload, false)
	}
	if options.Edit || options.Vision {
		fixture, err := referenceImage()
		if err != nil {
			return report, err
		}
		if options.Vision {
			payload, err := visionRequest(options.ChatModel, fixture)
			if err != nil {
				return report, err
			}
			request("chat_vision_stream", http.MethodPost, "/chat/completions", "application/json", payload, true)
		}
		if options.Edit {
			payload, contentType, err := editRequest(options, fixture)
			if err != nil {
				return report, err
			}
			request("image_edit_"+options.EditFormat, http.MethodPost, "/images/edits", contentType, payload, false)
		}
	}
	return report, nil
}

func observe(ctx context.Context, client *http.Client, options Options, base *url.URL, kind, method, path, contentType string, payload []byte, stream bool) (result Observation) {
	start := time.Now()
	result = Observation{Operation: kind, Path: path}
	defer func() { result.Milliseconds = time.Since(start).Milliseconds() }()
	target := *base
	target.Path += path
	if err := options.Policy.ValidateDestination(ctx, &target); err != nil {
		result.Error = "NETWORK_POLICY_OR_DNS"
		return result
	}
	request, err := http.NewRequestWithContext(ctx, method, target.String(), bytes.NewReader(payload))
	if err != nil {
		result.Error = "REQUEST_INVALID"
		return result
	}
	request.Header.Set("Authorization", "Bearer "+options.APIKey)
	request.Header.Set("Accept", "application/json")
	if stream {
		request.Header.Set("Accept", "text/event-stream")
	}
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	response, err := client.Do(request)
	result.Milliseconds = time.Since(start).Milliseconds()
	if err != nil {
		result.Error = "NETWORK_OR_TIMEOUT"
		return result
	}
	defer func() {
		if err := response.Body.Close(); err != nil && result.Error == "" {
			result.Error = "RESPONSE_CLOSE_FAILED"
		}
	}()
	result.Status = response.StatusCode
	result.ContentType = response.Header.Get("Content-Type")
	if strings.Contains(result.ContentType, options.APIKey) || len(result.ContentType) > 200 {
		result.ContentType = ""
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		// Keep status and error category only; error bodies may contain credentials or input.
		result.Error = "HTTP_REJECTED"
		if response.StatusCode == http.StatusTooManyRequests {
			result.Error = "RATE_LIMITED"
		}
		return result
	}
	if stream {
		scanner := bufio.NewScanner(io.LimitReader(response.Body, 8<<20))
		scanner.Buffer(make([]byte, 4096), 1<<20)
		fields := map[string]bool{}
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if !strings.HasPrefix(line, "data:") {
				continue
			}
			data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if data == "[DONE]" {
				result.Done = true
				break
			}
			var chunk map[string]json.RawMessage
			if json.Unmarshal([]byte(data), &chunk) != nil {
				result.Error = "INVALID_STREAM_JSON"
				break
			}
			result.Chunks++
			for name := range chunk {
				if len(name) < 80 && !strings.Contains(name, options.APIKey) {
					fields[name] = true
				}
			}
		}
		for name := range fields {
			result.ChunkFields = append(result.ChunkFields, name)
		}
		slices.Sort(result.ChunkFields)
		if scanner.Err() != nil || !result.Done {
			result.Error = "STREAM_INTERRUPTED"
		}
	} else {
		var body struct {
			Data []map[string]json.RawMessage `json:"data"`
		}
		decoder := json.NewDecoder(io.LimitReader(response.Body, 32<<20))
		if err := decoder.Decode(&body); err != nil || body.Data == nil {
			result.Error = "INVALID_RESPONSE"
		} else if kind == "models" {
			for _, model := range body.Data {
				var id string
				if json.Unmarshal(model["id"], &id) == nil && len(id) <= 200 && !strings.Contains(id, options.APIKey) {
					result.Models = append(result.Models, id)
				}
			}
		} else {
			result.Results = len(body.Data)
			for _, item := range body.Data {
				for _, format := range []string{"b64_json", "url"} {
					if _, exists := item[format]; exists && !slices.Contains(result.Formats, format) {
						result.Formats = append(result.Formats, format)
					}
				}
			}
		}
	}
	result.Milliseconds = time.Since(start).Milliseconds()
	return result
}

func referenceImage() ([]byte, error) {
	canvas := image.NewRGBA(image.Rect(0, 0, 256, 256))
	for y := range 256 {
		for x := range 256 {
			canvas.SetRGBA(x, y, color.RGBA{R: 255, G: 255, B: 255, A: 255})
		}
	}
	for y := 80; y < 176; y++ {
		for x := 80; x < 176; x++ {
			canvas.SetRGBA(x, y, color.RGBA{B: 255, A: 255})
		}
	}
	var output bytes.Buffer
	if err := png.Encode(&output, canvas); err != nil {
		return nil, fmt.Errorf("encode probe reference: %w", err)
	}
	return output.Bytes(), nil
}

func editRequest(options Options, fixture []byte) ([]byte, string, error) {
	if options.EditFormat == "json" {
		payload, err := json.Marshal(map[string]any{
			"model": options.ImageModel, "prompt": "Change the blue square to a red square.",
			"quality": options.Quality, "size": options.Size, "n": options.Count,
			"images": []map[string]string{{"image_url": dataURL(fixture)}}, "response_format": "b64_json",
		})
		if err != nil {
			return nil, "", fmt.Errorf("encode JSON edit probe: %w", err)
		}
		return payload, "application/json", nil
	}
	var payload bytes.Buffer
	writer := multipart.NewWriter(&payload)
	for name, value := range map[string]string{"model": options.ImageModel, "prompt": "Change the blue square to a red square.", "quality": options.Quality, "size": options.Size, "n": fmt.Sprint(options.Count), "response_format": "b64_json"} {
		if err := writer.WriteField(name, value); err != nil {
			return nil, "", fmt.Errorf("encode multipart probe field: %w", err)
		}
	}
	part, err := writer.CreateFormFile("image", "probe.png")
	if err != nil {
		return nil, "", fmt.Errorf("create probe file part: %w", err)
	}
	if _, err := part.Write(fixture); err != nil {
		return nil, "", fmt.Errorf("write probe file part: %w", err)
	}
	if err := writer.Close(); err != nil {
		return nil, "", fmt.Errorf("finish multipart probe: %w", err)
	}
	return payload.Bytes(), writer.FormDataContentType(), nil
}
