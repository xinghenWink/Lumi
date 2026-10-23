package catalog

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/pagination"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

func validSize(value string) bool {
	if value == "auto" {
		return true
	}
	parts := strings.Split(value, "x")
	if len(parts) != 2 {
		return false
	}
	for _, part := range parts {
		n, err := strconv.Atoi(part)
		if err != nil || n < 1 || n > 8192 || strconv.Itoa(n) != part {
			return false
		}
	}
	return true
}
func validCapabilities(kind string, c Capabilities) bool {
	if kind == "chat" {
		return c.MaxContextTokens >= 1 && c.MaxContextTokens <= 1000000
	}
	if kind != "image" || len(c.Qualities) < 1 || len(c.Qualities) > 3 || len(c.Sizes) < 1 || len(c.Sizes) > 20 || c.MaxN < 1 || c.MaxN > 10 || c.MaxReferenceImages < 0 || c.MaxReferenceImages > 4 || (c.SupportsEdit && c.MaxReferenceImages == 0) || (c.ResponseFormat != "b64_json" && c.ResponseFormat != "url") {
		return false
	}
	seen := map[string]bool{}
	for _, value := range c.Qualities {
		if !slices.Contains([]string{"low", "medium", "high"}, value) || seen[value] {
			return false
		}
		seen[value] = true
	}
	seen = map[string]bool{}
	for _, value := range c.Sizes {
		if !validSize(value) || seen[value] {
			return false
		}
		seen[value] = true
	}
	return true
}
func modelInput(input *ModelInput) error {
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	input.Description = strings.TrimSpace(input.Description)
	input.Icon = strings.TrimSpace(input.Icon)
	if !validation.Text(input.DisplayName, 1, 80) || !validation.Text(input.Description, 0, 500) || !validation.Text(input.Icon, 0, 40) || !validCapabilities(input.Type, input.Capabilities) || input.SortOrder < 0 || input.SortOrder > 10000 || len(input.Routes) > 20 || (input.IsDefault && !input.Enabled) {
		return problem.Invalid()
	}
	if input.Capabilities.Qualities == nil {
		input.Capabilities.Qualities = []string{}
	}
	if input.Capabilities.Sizes == nil {
		input.Capabilities.Sizes = []string{}
	}
	seen := map[string]bool{}
	for i := range input.Routes {
		route := &input.Routes[i]
		route.UpstreamModelName = strings.TrimSpace(route.UpstreamModelName)
		key := route.UpstreamID.String() + ":" + route.UpstreamModelName
		if route.UpstreamID == uuid.Nil || !validation.Text(route.UpstreamModelName, 1, 200) || !validRank(route.Priority, route.Weight) || seen[key] {
			return problem.Invalid()
		}
		seen[key] = true
	}
	return nil
}
func publicView(row query.Model) (PublicModel, error) {
	var capabilities Capabilities
	if err := json.Unmarshal(row.Capabilities, &capabilities); err != nil {
		return PublicModel{}, fmt.Errorf("decode model capabilities: %w", err)
	}
	if capabilities.Qualities == nil {
		capabilities.Qualities = []string{}
	}
	if capabilities.Sizes == nil {
		capabilities.Sizes = []string{}
	}
	return PublicModel{ID: row.ID, DisplayName: row.DisplayName, Type: row.Type, Description: row.Description, Icon: row.Icon, SortOrder: row.SortOrder, IsDefault: row.IsDefault, Capabilities: capabilities}, nil
}
func modelView(ctx context.Context, q *query.Queries, row query.Model) (Model, error) {
	public, err := publicView(row)
	if err != nil {
		return Model{}, err
	}
	routes, err := q.ListModelRoutes(ctx, row.ID)
	if err != nil {
		return Model{}, fmt.Errorf("read model routes: %w", err)
	}
	result := Model{PublicModel: public, Enabled: row.Enabled, Version: row.Version, CreatedAt: row.CreatedAt.UTC(), UpdatedAt: row.UpdatedAt.UTC(), Routes: make([]Route, 0, len(routes))}
	for _, route := range routes {
		result.Routes = append(result.Routes, Route{ID: route.ID, UpstreamName: route.UpstreamName, UpstreamEnabled: route.UpstreamEnabled, RouteInput: RouteInput{UpstreamID: route.UpstreamID, UpstreamModelName: route.UpstreamModelName, Priority: route.Priority, Weight: route.Weight, Enabled: route.Enabled}})
	}
	return result, nil
}
func (s *Service) Models(ctx context.Context, filter Filter) (Page[Model], error) {
	if !validFilter(filter) {
		return Page[Model]{}, problem.Invalid()
	}
	fingerprint, err := filterFingerprint(filter)
	if err != nil {
		return Page[Model]{}, err
	}
	cursor, err := pagination.Decode(filter.Cursor, fingerprint)
	if err != nil {
		return Page[Model]{}, err
	}
	rows, err := s.queries.ListAdminModels(ctx, query.ListAdminModelsParams{Search: filter.Search, KindFilter: filter.Kind, StateFilter: filter.State, CursorTime: cursor.Time, CursorID: &cursor.ID, PageLimit: filter.Limit + 1})
	if err != nil {
		return Page[Model]{}, fmt.Errorf("list platform models: %w", err)
	}
	result := Page[Model]{Items: make([]Model, 0, len(rows))}
	if len(rows) > int(filter.Limit) {
		rows = rows[:filter.Limit]
		last := rows[len(rows)-1]
		result.NextCursor, err = pagination.Encode(last.CreatedAt, last.ID, fingerprint)
		if err != nil {
			return result, err
		}
	}
	for _, row := range rows {
		model, err := modelView(ctx, s.queries, row)
		if err != nil {
			return result, err
		}
		result.Items = append(result.Items, model)
	}
	return result, nil
}
func (s *Service) Public(ctx context.Context, kind string) ([]PublicModel, error) {
	if kind != "chat" && kind != "image" {
		return nil, problem.Invalid()
	}
	rows, err := s.queries.ListPublicModels(ctx, kind)
	if err != nil {
		return nil, fmt.Errorf("read available platform models: %w", err)
	}
	result := make([]PublicModel, 0, len(rows))
	hasDefault := false
	for _, row := range rows {
		model, err := publicView(row)
		if err != nil {
			return nil, err
		}
		hasDefault = hasDefault || model.IsDefault
		result = append(result, model)
	}
	if len(result) > 0 && !hasDefault {
		result[0].IsDefault = true
	}
	return result, nil
}
func writeModel(ctx context.Context, q *query.Queries, id uuid.UUID, input ModelInput) (Model, any, error) {
	creating := id == uuid.Nil
	var before any
	if creating {
		var err error
		id, err = validation.NewID()
		if err != nil {
			return Model{}, nil, err
		}
	} else {
		old, err := q.LockPlatformModel(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return Model{}, nil, problem.New("MODEL_NOT_FOUND", http.StatusNotFound)
		}
		if err != nil {
			return Model{}, nil, fmt.Errorf("lock platform model: %w", err)
		}
		if old.Version != input.Version {
			return Model{}, nil, problem.New("CONFIGURATION_CONFLICT", http.StatusConflict)
		}
		if old.Type != input.Type {
			return Model{}, nil, problem.Invalid()
		}
		before, err = modelView(ctx, q, old)
		if err != nil {
			return Model{}, nil, err
		}
	}
	var previousDefault any
	if input.IsDefault {
		previous, err := q.GetDefaultPlatformModel(ctx, input.Type)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return Model{}, nil, fmt.Errorf("read previous default: %w", err)
		}
		if err == nil {
			previousDefault, err = publicView(previous)
			if err != nil {
				return Model{}, nil, err
			}
		}
		if err := q.ClearDefaultModel(ctx, query.ClearDefaultModelParams{Type: input.Type, ID: id}); err != nil {
			return Model{}, nil, fmt.Errorf("replace default model: %w", err)
		}
	}
	for _, route := range input.Routes {
		if _, err := q.GetUpstream(ctx, route.UpstreamID); errors.Is(err, pgx.ErrNoRows) {
			return Model{}, nil, problem.New("UPSTREAM_NOT_FOUND", http.StatusNotFound)
		} else if err != nil {
			return Model{}, nil, fmt.Errorf("check bound upstream: %w", err)
		}
	}
	encoded, err := json.Marshal(input.Capabilities)
	if err != nil {
		return Model{}, nil, fmt.Errorf("encode capabilities: %w", err)
	}
	var row query.Model
	if creating {
		row, err = q.CreatePlatformModel(ctx, query.CreatePlatformModelParams{ID: id, DisplayName: input.DisplayName, Type: input.Type, Description: input.Description, Icon: input.Icon, SortOrder: input.SortOrder, Enabled: input.Enabled, IsDefault: input.IsDefault, Capabilities: encoded})
	} else {
		row, err = q.UpdatePlatformModel(ctx, query.UpdatePlatformModelParams{ID: id, DisplayName: input.DisplayName, Type: input.Type, Description: input.Description, Icon: input.Icon, SortOrder: input.SortOrder, Enabled: input.Enabled, IsDefault: input.IsDefault, Capabilities: encoded})
	}
	if err != nil {
		return Model{}, nil, fmt.Errorf("save platform model: %w", configError(err))
	}
	if err := q.ClearModelRoutes(ctx, id); err != nil {
		return Model{}, nil, fmt.Errorf("replace model routes: %w", err)
	}
	for _, route := range input.Routes {
		routeID, err := validation.NewID()
		if err != nil {
			return Model{}, nil, err
		}
		if err := q.CreateModelRoute(ctx, query.CreateModelRouteParams{ID: routeID, ModelID: id, UpstreamID: route.UpstreamID, UpstreamModelName: route.UpstreamModelName, Priority: route.Priority, Weight: route.Weight, Enabled: route.Enabled}); err != nil {
			return Model{}, nil, fmt.Errorf("bind model route: %w", err)
		}
	}
	result, err := modelView(ctx, q, row)
	return result, map[string]any{"model": before, "previous_default": previousDefault}, err
}
func (s *Service) SaveModel(ctx context.Context, actor user.Actor, id uuid.UUID, input ModelInput) (Model, error) {
	if err := modelInput(&input); err != nil {
		return Model{}, err
	}
	var result Model
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		if err := q.LockModelConfiguration(ctx); err != nil {
			return fmt.Errorf("lock models: %w", err)
		}
		var before any
		var err error
		result, before, err = writeModel(ctx, q, id, input)
		if err != nil {
			return err
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "model.save", TargetType: "model", TargetID: &result.ID, Before: before, After: result, IP: actor.IP})
	})
	return result, err
}
func (s *Service) DeleteModel(ctx context.Context, actor user.Actor, id uuid.UUID) error {
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		if err := q.LockModelConfiguration(ctx); err != nil {
			return fmt.Errorf("lock model deletion: %w", err)
		}
		old, err := q.LockPlatformModel(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.New("MODEL_NOT_FOUND", http.StatusNotFound)
		}
		if err != nil {
			return fmt.Errorf("lock deleted model: %w", err)
		}
		before, err := modelView(ctx, q, old)
		if err != nil {
			return err
		}
		if err := q.LockCreditConfiguration(ctx); err != nil {
			return fmt.Errorf("lock model pricing: %w", err)
		}
		if err := q.DeleteModelPricing(ctx, &id); err != nil {
			return fmt.Errorf("delete model price overrides: %w", err)
		}
		if err := q.DeletePlatformModel(ctx, id); err != nil {
			return fmt.Errorf("delete platform model: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "model.delete", TargetType: "model", TargetID: &id, Before: before, IP: actor.IP})
	})
}
