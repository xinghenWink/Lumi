package chat

import (
	"testing"
	"time"
)

func TestAwaitTitleNeverHoldsTheFinishedAnswer(t *testing.T) {
	ready := make(chan string, 1)
	ready <- "量子纠缠"
	if title := awaitTitle(ready, "fallback", time.Second); title != "量子纠缠" {
		t.Fatalf("ready title ignored: %q", title)
	}
	pending := make(chan string)
	start := time.Now()
	if title := awaitTitle(pending, "fallback", 20*time.Millisecond); title != "fallback" {
		t.Fatalf("pending title did not fall back: %q", title)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("pending title held the answer for %v", elapsed)
	}
}
