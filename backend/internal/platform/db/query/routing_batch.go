package query

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type batchSender interface {
	SendBatch(context.Context, *pgx.Batch) pgx.BatchResults
}

// ReadChatRouting reads model availability and eligible routes from one batch.
func (q *Queries) ReadChatRouting(ctx context.Context, id uuid.UUID) (model Model, routes []AvailableModelRoutesRow, resultErr error) {
	sender, ok := q.db.(batchSender)
	if !ok {
		return model, nil, fmt.Errorf("routing requires a PostgreSQL batch sender")
	}
	batch := &pgx.Batch{}
	batch.Queue(getPlatformModel, id)
	batch.Queue(availableModelRoutes, id)
	results := sender.SendBatch(ctx, batch)
	defer func() {
		if err := results.Close(); err != nil && resultErr == nil {
			resultErr = fmt.Errorf("close routing reads: %w", err)
		}
	}()
	reader := New(batchReader{results})
	var err error
	model, err = reader.GetPlatformModel(ctx, id)
	if err != nil {
		return model, nil, err
	}
	routes, err = reader.AvailableModelRoutes(ctx, id)
	return model, routes, err
}

// RecordSuccessfulUpstreamCall pipelines health reset and call history atomically.
func (q *Queries) RecordSuccessfulUpstreamCall(ctx context.Context, call AppendUpstreamCallParams) (resultErr error) {
	sender, ok := q.db.(batchSender)
	if !ok {
		return fmt.Errorf("call history requires a PostgreSQL batch sender")
	}
	batch := &pgx.Batch{}
	batch.Queue(recordCircuitSuccess, call.UpstreamID)
	batch.Queue(appendUpstreamCall, call.ID, call.UpstreamID, call.Model, call.Kind, call.LatencyMs, call.Status, call.ErrorSummary, call.RequestID)
	results := sender.SendBatch(ctx, batch)
	defer func() {
		if err := results.Close(); err != nil && resultErr == nil {
			resultErr = fmt.Errorf("close successful call: %w", err)
		}
	}()
	reader := New(batchReader{results})
	if err := reader.RecordCircuitSuccess(ctx, call.UpstreamID); err != nil {
		return fmt.Errorf("reset successful circuit: %w", err)
	}
	if err := reader.AppendUpstreamCall(ctx, call); err != nil {
		return fmt.Errorf("append successful call: %w", err)
	}
	return nil
}
