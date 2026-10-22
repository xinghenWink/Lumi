package images

import (
	"context"
	"errors"
	"testing"

	"github.com/xinghenWink/Lumi/backend/internal/user"
)

func TestCanceledSubmissionLeavesCapacityWithoutTouchingDependencies(t *testing.T) {
	service := &Service{submissions: make(chan struct{}, 1)}
	service.submissions <- struct{}{}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	// No database or billing dependency exists: cancellation must return before either.
	if _, err := service.Submit(ctx, user.Actor{}, "canceled-test", Input{}); !errors.Is(err, context.Canceled) {
		t.Fatalf("queued cancellation=%v", err)
	}
}
