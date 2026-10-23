package chat

import (
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/upstream"
)

// EstimateTokens deliberately overestimates multibyte text; this is not billed usage.
func EstimateTokens(text string) int {
	count := 0
	for _, r := range text {
		if r < 128 {
			count++
		} else {
			count += 4
		}
	}
	return (count+2)/3 + 8
}
func wireMessage(role, content string) upstream.Message {
	encoded, err := json.Marshal(content)
	if err != nil {
		encoded = []byte(`""`)
	}
	return upstream.Message{Role: role, Content: encoded}
}
func BuildContext(rows []query.Message, config Configuration, modelLimit int32) ([]upstream.Message, error) {
	limit := int(config.ContextTokens)
	if modelLimit > 0 && int(modelLimit) < limit {
		limit = int(modelLimit)
	}
	// Reserve output space while keeping the system instruction intact.
	reserve := min(1024, max(16, limit/8))
	budget := limit - reserve
	result := make([]upstream.Message, 0, int(config.ContextMessages)+1)
	used := 0
	if config.SystemPrompt != "" {
		used = EstimateTokens(config.SystemPrompt)
		result = append(result, wireMessage("system", config.SystemPrompt))
	}
	if len(rows) == 0 {
		return result, problem.Invalid()
	}
	first := max(0, len(rows)-int(config.ContextMessages))
	// Never begin context with an assistant whose user turn was discarded.
	for first < len(rows)-1 && rows[first].Role != "user" {
		first++
	}
	for first < len(rows) {
		cost := used
		for _, row := range rows[first:] {
			cost += EstimateTokens(row.Content)
			cost += len(row.ReferenceFileIds) * 1024
		}
		if cost <= budget {
			for _, row := range rows[first:] {
				result = append(result, wireMessage(row.Role, row.Content))
			}
			return result, nil
		}
		first++
		for first < len(rows) && rows[first].Role != "user" {
			first++
		}
	}
	return nil, problem.New("CHAT_CONTEXT_TOO_LARGE", 400)
}
func fallbackTitle(content string) string {
	value := strings.TrimSpace(strings.Split(strings.Split(content, "\n")[0], "。")[0])
	if value == "" {
		value = strings.TrimSpace(content)
	}
	runes := []rune(value)
	return string(runes[:min(len(runes), 20)])
}
func validContent(content string) bool {
	return strings.TrimSpace(content) != "" && len(content) <= 64000 && utf8.ValidString(content) && !strings.ContainsRune(content, 0)
}
