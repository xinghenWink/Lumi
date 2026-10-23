package chat

import (
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"strings"
	"testing"
)

func TestContextPreservesSystemAndWholeRecentTurns(t *testing.T) {
	rows := []query.Message{{Role: "user", Content: "first"}, {Role: "assistant", Content: "first answer"}, {Role: "user", Content: "recent"}, {Role: "assistant", Content: "recent answer"}, {Role: "user", Content: "last"}}
	config := Configuration{ContextMessages: 4, ContextTokens: 128, SystemPrompt: "system"}
	messages, err := BuildContext(rows, config, 128)
	if err != nil || len(messages) != 4 || messages[0].Role != "system" || string(messages[1].Content) != "\"recent\"" {
		t.Fatalf("context=%v error=%v", messages, err)
	}
	config.SystemPrompt = strings.Repeat("中", 1000)
	if _, err := BuildContext(rows, config, 128); err == nil {
		t.Fatal("oversized system silently removed")
	}
	config.SystemPrompt = ""
	rows = []query.Message{{Role: "user", Content: strings.Repeat("中", 1000)}}
	if _, err := BuildContext(rows, config, 128); err == nil {
		t.Fatal("oversized user silently truncated")
	}
}
func TestTitlesAndSafeUsage(t *testing.T) {
	if title := fallbackTitle("  一个标题。后续内容\n另一行"); title != "一个标题" {
		t.Fatal(title)
	}
	if len([]rune(fallbackTitle(strings.Repeat("中", 25)))) != 20 {
		t.Fatal("title too long")
	}
	if safeUsage([]byte(`{"prompt_tokens":-1}`)) != nil {
		t.Fatal("negative usage accepted")
	}
	if safeUsage([]byte(`{"prompt_tokens":12,"completion_tokens":4,"total_tokens":16,"secret":"hidden"}`)).TotalTokens != 16 {
		t.Fatal("valid usage rejected")
	}
}
