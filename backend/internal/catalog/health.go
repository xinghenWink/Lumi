package catalog

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"time"

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/settings"
)

func (s *Service) circuitConfig(ctx context.Context) (int32, int32, error) {
	records, err := s.queries.ListSettings(ctx)
	if err != nil {
		return 0, 0, fmt.Errorf("read circuit settings: %w", err)
	}
	threshold, duration := int32(5), int32(60)
	for _, r := range records {
		if r.Key == "operations" {
			var cfg settings.Operations
			if err := json.Unmarshal(r.Value, &cfg); err != nil {
				return 0, 0, fmt.Errorf("decode circuit settings: %w", err)
			}
			if cfg.CircuitFailures > 0 {
				threshold = cfg.CircuitFailures
			}
			if cfg.CircuitSeconds > 0 {
				duration = cfg.CircuitSeconds
			}
		}
	}
	return threshold, duration, nil
}

func channelView(row query.Upstream) Channel {
	v := baseChannelView(row)
	v.CircuitState = "closed"
	v.ConsecutiveFailures = row.ConsecutiveFailures
	v.LastError = row.LastError
	v.OpenUntil = row.OpenUntil
	if row.OpenUntil != nil {
		v.CircuitState = "open"
		if !row.OpenUntil.After(time.Now()) {
			v.CircuitState = "half_open"
		}
	}
	return v
}

// WeightedOrder samples without replacement within priority groups.
func WeightedOrder(rows []query.AvailableModelRoutesRow) ([]query.AvailableModelRoutesRow, error) {
	pending := append([]query.AvailableModelRoutesRow(nil), rows...)
	ordered := make([]query.AvailableModelRoutesRow, 0, len(rows))
	for len(pending) > 0 {
		priority := pending[0].RoutePriority
		group, total := 0, int64(0)
		for group < len(pending) && pending[group].RoutePriority == priority {
			total += int64(pending[group].RouteWeight)
			group++
		}
		if total <= 0 {
			return nil, fmt.Errorf("invalid route weights")
		}
		draw, err := rand.Int(rand.Reader, big.NewInt(total))
		if err != nil {
			return nil, fmt.Errorf("sample route: %w", err)
		}
		selected, value := 0, draw.Int64()
		for selected < group-1 && value >= int64(pending[selected].RouteWeight) {
			value -= int64(pending[selected].RouteWeight)
			selected++
		}
		ordered = append(ordered, pending[selected])
		pending = append(pending[:selected], pending[selected+1:]...)
	}
	return ordered, nil
}
func (s *Service) routeTargets(ctx context.Context, id uuid.UUID) ([]query.AvailableModelRoutesRow, error) {
	return routeTargets(ctx, s.queries, id)
}
func routeTargets(ctx context.Context, q *query.Queries, id uuid.UUID) ([]query.AvailableModelRoutesRow, error) {
	rows, err := q.AvailableModelRoutes(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("read available routes: %w", err)
	}
	return WeightedOrder(rows)
}
func (s *Service) permit(ctx context.Context, id uuid.UUID) error {
	row, err := s.queries.GetUpstream(ctx, id)
	if err != nil {
		return fmt.Errorf("read circuit state: %w", err)
	}
	if row.OpenUntil == nil {
		return nil
	}
	if row.OpenUntil.After(time.Now()) {
		return problem.New("UPSTREAM_CIRCUIT_OPEN", 503)
	}
	count, err := s.queries.AcquireCircuitProbe(ctx, id)
	if err != nil {
		return fmt.Errorf("claim circuit probe: %w", err)
	}
	if count != 1 {
		return problem.New("UPSTREAM_CIRCUIT_OPEN", 503)
	}
	return nil
}
