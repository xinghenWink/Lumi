package upstream

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// The caller must cancel ctx if it stops consuming before the stream closes.
func (c *Client) ChatStream(ctx context.Context, input ChatRequest) (<-chan ChatEvent, error) {
	if !validRemoteName(input.Model) || len(input.Messages) == 0 || len(input.Messages) > 200 {
		return nil, &Failure{Code: "UPSTREAM_REQUEST_INVALID"}
	}
	body, err := json.Marshal(struct {
		ChatRequest
		Stream bool `json:"stream"`
	}{input, true})
	if err != nil || len(body) > 4<<20 {
		return nil, &Failure{Code: "UPSTREAM_REQUEST_INVALID"}
	}
	start := time.Now()
	response, err := c.open(ctx, false, http.MethodPost, "/chat/completions", "application/json", bytes.NewReader(body))
	if err != nil {
		c.observe(ctx, "chat", input.Model, start, responseStatus(response, err), err)
		return nil, err
	}
	events := make(chan ChatEvent, 16)
	go func() {
		defer close(events)
		var result error
		defer func() { c.observe(ctx, "chat", input.Model, start, response.StatusCode, result) }()
		defer closeBody(response, &result)
		send := func(event ChatEvent) bool {
			select {
			case events <- event:
				return true
			case <-ctx.Done():
				return false
			}
		}
		if !strings.Contains(response.Header.Get("Content-Type"), "text/event-stream") {
			result = &Failure{Code: "UPSTREAM_RESPONSE_INVALID"}
			send(ChatEvent{ErrorCode: FailureCode(result)})
			return
		}
		scanner := bufio.NewScanner(io.LimitReader(response.Body, 8<<20))
		scanner.Buffer(make([]byte, 4096), 1<<20)
		data := make([]string, 0, 1)
		done := false
		consume := func() bool {
			if len(data) == 0 {
				return true
			}
			value := strings.Join(data, "\n")
			data = data[:0]
			if value == "[DONE]" {
				done = true
				return false
			}
			var chunk struct {
				Choices []struct {
					Delta struct {
						Content *string `json:"content"`
					} `json:"delta"`
					Finish *string `json:"finish_reason"`
				} `json:"choices"`
				Usage json.RawMessage `json:"usage"`
				Error json.RawMessage `json:"error"`
			}
			if json.Unmarshal([]byte(value), &chunk) != nil || len(chunk.Error) != 0 || (chunk.Choices == nil && len(chunk.Usage) == 0) {
				result = &Failure{Code: "UPSTREAM_STREAM_INTERRUPTED"}
				return false
			}
			event := ChatEvent{Usage: chunk.Usage}
			if len(chunk.Choices) > 0 {
				choice := chunk.Choices[0]
				if choice.Delta.Content != nil {
					event.Content = *choice.Delta.Content
				}
				if choice.Finish != nil {
					event.FinishReason = *choice.Finish
				}
			}
			return send(event)
		}
		for scanner.Scan() {
			line := scanner.Text()
			if line == "" {
				if !consume() {
					break
				}
			} else if strings.HasPrefix(line, "data:") {
				data = append(data, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
			}
		}
		if !done && result == nil {
			if err := ctx.Err(); err != nil {
				result = fmt.Errorf("consume upstream stream: %w", err)
			} else {
				result = &Failure{Code: "UPSTREAM_STREAM_INTERRUPTED"}
			}
		}
		if result != nil {
			send(ChatEvent{ErrorCode: FailureCode(result)})
		}
	}()
	return events, nil
}
