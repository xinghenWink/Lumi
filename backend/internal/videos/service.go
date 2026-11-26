package videos

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xinghenWink/Lumi/backend/internal/catalog"
	"github.com/xinghenWink/Lumi/backend/internal/credits"
	"github.com/xinghenWink/Lumi/backend/internal/media"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/pagination"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/upstream/video"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

const MaxVideoUpload = 100 << 20
const MaxAudioUpload = 15 << 20
const MaxOutput = 200 << 20

type AssetReference struct {
	FileID uuid.UUID  `json:"file_id"`
	Role   video.Role `json:"role"`
	Token  string     `json:"token,omitempty"`
}

type Input struct {
	video.Options
	ModelID    uuid.UUID        `json:"model_id"`
	Count      int              `json:"count"`
	Prompt     string           `json:"prompt"`
	References []AssetReference `json:"references"`
}

type Submission struct {
	Input
	ConfirmedQuote credits.VideoQuote `json:"confirmed_quote"`
}

type Item struct {
	Position  int32      `json:"position"`
	Status    string     `json:"status"`
	ErrorCode string     `json:"error_code,omitempty"`
	FileID    *uuid.UUID `json:"file_id,omitempty"`
}

type Task struct {
	ID        uuid.UUID          `json:"id"`
	CanvasID  *uuid.UUID         `json:"canvas_id,omitempty"`
	ModelName string             `json:"model_name"`
	Input     Input              `json:"input"`
	Quote     credits.VideoQuote `json:"quote"`
	Status    string             `json:"status"`
	Refunded  int64              `json:"refunded"`
	Items     []Item             `json:"items"`
	CreatedAt time.Time          `json:"created_at"`
	UpdatedAt time.Time          `json:"updated_at"`
}

type Choice struct {
	Model    catalog.PublicModel  `json:"model"`
	Profiles []video.Profile      `json:"profiles"`
	Pricing  credits.VideoPricing `json:"pricing"`
}

type Page[T any] struct {
	Items      []T    `json:"items"`
	NextCursor string `json:"next_cursor"`
}

type Service struct {
	pool         *pgxpool.Pool
	q            *query.Queries
	byModel      *catalog.Service
	billing      *credits.Service
	files        *media.Store
	logger       *slog.Logger
	publicOrigin string
	mentions     *regexp.Regexp
}

func New(pool *pgxpool.Pool, models *catalog.Service, billing *credits.Service, files *media.Store, publicOrigin string, logger *slog.Logger) *Service {
	return &Service{pool: pool, q: query.New(pool), byModel: models, billing: billing, files: files, logger: logger, publicOrigin: strings.TrimRight(publicOrigin, "/"), mentions: regexp.MustCompile(`@\[[A-Za-z0-9_-]{1,50}\]`)}
}

func only[T comparable](values, allowed []T) []T {
	result := make([]T, 0, len(values))
	for _, value := range values {
		if slices.Contains(allowed, value) {
			result = append(result, value)
		}
	}
	return result
}

func intersect(p, q video.Profile) (video.Profile, bool) {
	if p.Mode != q.Mode {
		return p, false
	}
	p.Ratios = only(p.Ratios, q.Ratios)
	p.Resolutions = only(p.Resolutions, q.Resolutions)
	p.Durations = only(p.Durations, q.Durations)
	p.Images = min(p.Images, q.Images)
	p.Videos = min(p.Videos, q.Videos)
	p.Audio = min(p.Audio, q.Audio)
	p.Total = min(p.Total, q.Total)
	p.AudioOnly = p.AudioOnly && q.AudioOnly
	return p, (video.Capabilities{Profiles: []video.Profile{p}}).Valid()
}

func hasPricedOptions(profile video.Profile, pricing credits.VideoPricing) bool {
	for _, size := range profile.Resolutions {
		for _, duration := range profile.Durations {
			if _, ok := pricing.UnitPrice(size, duration, false); ok && (profile.Mode != video.Reference || profile.Images > 0 || profile.AudioOnly) {
				return true
			}
			if _, ok := pricing.UnitPrice(size, duration, true); ok && profile.Videos > 0 {
				return true
			}
		}
	}
	return false
}

func (s *Service) Options(ctx context.Context) ([]Choice, error) {
	models, err := s.byModel.Public(ctx, "video")
	if err != nil {
		return nil, err
	}
	result := make([]Choice, 0, len(models))
	for _, model := range models {
		pricing, err := credits.ReadVideoPricing(ctx, s.q, model.ID)
		if err != nil {
			return nil, err
		}
		if len(pricing.Rates) == 0 || model.Capabilities.Video == nil {
			continue
		}
		_, targets, err := s.byModel.VideoTargets(ctx, s.q, model.ID)
		if err != nil {
			var failure *problem.Error
			if errors.As(err, &failure) && failure.Code == "VIDEO_MODEL_UNAVAILABLE" {
				continue
			}
			return nil, err
		}
		profiles := make([]video.Profile, 0)
		seen := make(map[string]bool)
		include := func(profile video.Profile) {
			if !hasPricedOptions(profile, pricing) {
				return
			}
			key := fmt.Sprint(profile)
			if !seen[key] {
				seen[key] = true
				profiles = append(profiles, profile)
			}
		}
		for _, target := range targets {
			caps := target.Capabilities
			if caps == nil {
				for _, p := range model.Capabilities.Video.Profiles {
					include(p)
				}
				continue
			}
			for _, modelProfile := range model.Capabilities.Video.Profiles {
				for _, routeProfile := range caps.Profiles {
					p, ok := intersect(modelProfile, routeProfile)
					if ok {
						include(p)
					}
				}
			}
		}
		if len(profiles) > 0 {
			result = append(result, Choice{Model: model, Profiles: profiles, Pricing: pricing})
		}
	}
	return result, nil
}

func (s *Service) validate(ctx context.Context, q *query.Queries, actor user.Actor, input Input) (catalog.PublicModel, []catalog.VideoRoute, credits.VideoQuote, error) {
	var empty catalog.PublicModel
	var quote credits.VideoQuote
	if input.ModelID == uuid.Nil || input.Count < 1 || input.Count > 4 || strings.TrimSpace(input.Prompt) == "" ||
		!utf8.ValidString(input.Prompt) || len(input.Prompt) > 28000 || strings.ContainsRune(input.Prompt, 0) || len(input.References) > 50 {
		return empty, nil, quote, problem.Invalid()
	}
	roles := make([]video.Role, 0, len(input.References))
	tokens := make(map[string]bool)
	ids := make(map[uuid.UUID]bool)
	hasVideo := false
	for _, ref := range input.References {
		if ref.FileID == uuid.Nil || ids[ref.FileID] {
			return empty, nil, quote, problem.Invalid()
		}
		ids[ref.FileID] = true
		if ref.Token != "" {
			if tokens[ref.Token] || s.mentions.FindString(ref.Token) != ref.Token || !strings.Contains(input.Prompt, ref.Token) {
				return empty, nil, quote, problem.Invalid()
			}
			tokens[ref.Token] = true
		}
		file, err := s.files.GetTx(ctx, q, actor.ID, ref.FileID)
		if err != nil {
			return empty, nil, quote, err
		}
		switch ref.Role {
		case video.Image, video.First, video.Last:
			if file.Kind != "upload" && file.Kind != "generated" {
				return empty, nil, quote, problem.Invalid()
			}
		case video.Video:
			if file.Kind != "video_upload" && file.Kind != "video_generated" {
				return empty, nil, quote, problem.Invalid()
			}
			hasVideo = true
		case video.Audio:
			if file.Kind != "audio_upload" {
				return empty, nil, quote, problem.Invalid()
			}
		default:
			return empty, nil, quote, problem.Invalid()
		}
		roles = append(roles, ref.Role)
	}
	for _, token := range s.mentions.FindAllString(input.Prompt, -1) {
		if !tokens[token] {
			return empty, nil, quote, problem.New("VIDEO_REFERENCE_MISSING", 400)
		}
	}
	if len(roles) > 0 {
		origin, err := url.Parse(s.publicOrigin)
		if err != nil || origin.Scheme != "https" || origin.Hostname() == "" {
			return empty, nil, quote, problem.New("VIDEO_REFERENCE_ORIGIN_REQUIRED", 409)
		}
	}
	model, targets, err := s.byModel.VideoTargets(ctx, q, input.ModelID)
	if err != nil {
		return model, nil, quote, err
	}
	routes := make([]catalog.VideoRoute, 0, len(targets))
	if model.Capabilities.Video != nil && model.Capabilities.Video.Supports(input.Options, roles) {
		for _, target := range targets {
			if target.Capabilities == nil || target.Capabilities.Supports(input.Options, roles) {
				routes = append(routes, target.Route)
			}
		}
	}
	if len(routes) == 0 {
		return model, nil, quote, problem.New("VIDEO_OPTIONS_UNAVAILABLE", 409)
	}
	quote, err = credits.QuoteVideo(ctx, q, input.ModelID, input.Resolution, input.Duration, input.Count, hasVideo)
	return model, routes, quote, err
}

func (s *Service) Quote(ctx context.Context, actor user.Actor, input Input) (credits.VideoQuote, error) {
	_, _, quote, err := s.validate(ctx, s.q, actor, input)
	return quote, err
}

type Resolve func(*query.Queries) (Submission, error)
type Attach func(*query.Queries, uuid.UUID, int) error

func (s *Service) QuoteResolved(ctx context.Context, actor user.Actor, resolve func(*query.Queries) (Input, error)) (credits.VideoQuote, error) {
	var quote credits.VideoQuote
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		input, err := resolve(q)
		if err != nil {
			return err
		}
		_, _, quote, err = s.validate(ctx, q, actor, input)
		return err
	})
	return quote, err
}

func (s *Service) Submit(ctx context.Context, actor user.Actor, key string, input Submission) (Task, error) {
	return s.SubmitResolved(ctx, actor, key, nil, input, func(*query.Queries) (Submission, error) { return input, nil }, nil)
}

func (s *Service) SubmitResolved(ctx context.Context, actor user.Actor, key string, canvas *uuid.UUID, request any, resolve Resolve, attach Attach) (Task, error) {
	if !credits.ValidKey(key) {
		return Task{}, problem.New("IDEMPOTENCY_KEY_INVALID", 400)
	}
	raw, err := json.Marshal(request)
	if err != nil {
		return Task{}, fmt.Errorf("encode video submission: %w", err)
	}
	digest := sha256.Sum256(raw)
	hash := hex.EncodeToString(digest[:])
	var row query.VideoTask
	err = db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		owner, err := q.GetUserForUpdate(ctx, actor.ID)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && (owner.Status != "active" || owner.TokenVersion != actor.TokenVersion)) {
			return problem.Unauthorized()
		}
		if err != nil {
			return fmt.Errorf("lock video owner: %w", err)
		}
		old, err := q.VideoTaskByKey(ctx, query.VideoTaskByKeyParams{UserID: actor.ID, IdempotencyKey: key})
		if err == nil {
			if old.RequestHash != hash {
				return problem.New("IDEMPOTENCY_CONFLICT", 409)
			}
			row = old
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("read video submission: %w", err)
		}
		input, err := resolve(q)
		if err != nil {
			return err
		}
		if err := q.ReadCreditConfigurationLock(ctx); err != nil {
			return fmt.Errorf("lock video quote: %w", err)
		}
		model, routes, quote, err := s.validate(ctx, q, actor, input.Input)
		if err != nil {
			return err
		}
		if input.ConfirmedQuote != quote {
			return problem.New("VIDEO_QUOTE_CHANGED", 409)
		}
		id, err := validation.NewID()
		if err != nil {
			return err
		}
		if err := s.billing.ApplyVideoTx(ctx, q, actor.ID, id, quote.Pool, -quote.TotalCost, "video-charge:"+id.String()); err != nil {
			return err
		}
		inputJSON, err := json.Marshal(input.Input)
		if err != nil {
			return fmt.Errorf("encode video input: %w", err)
		}
		routesJSON, err := json.Marshal(routes)
		if err != nil {
			return fmt.Errorf("encode video routes: %w", err)
		}
		quoteJSON, err := json.Marshal(quote)
		if err != nil {
			return fmt.Errorf("encode video quote: %w", err)
		}
		refs := make([]uuid.UUID, 0, len(input.References))
		for _, ref := range input.References {
			refs = append(refs, ref.FileID)
		}
		row, err = q.CreateVideoTask(ctx, query.CreateVideoTaskParams{ID: id, UserID: actor.ID, CanvasID: canvas, ModelID: input.ModelID, ModelName: model.DisplayName, Request: inputJSON, ReferencesIds: refs, Routes: routesJSON, Quote: quoteJSON, IdempotencyKey: key, RequestHash: hash, Deadline: time.Now().Add(2 * time.Hour)})
		if err != nil {
			return fmt.Errorf("create video task: %w", err)
		}
		if err := q.CreateVideoTaskItems(ctx, query.CreateVideoTaskItemsParams{TaskID: id, LastPosition: int32(input.Count - 1)}); err != nil { // #nosec G115 -- validate limits the count to 1–4.
			return fmt.Errorf("create video items: %w", err)
		}
		if attach != nil {
			return attach(q, id, input.Count)
		}
		return nil
	})
	if err != nil {
		return Task{}, err
	}
	return s.view(ctx, row)
}

func (s *Service) view(ctx context.Context, row query.VideoTask) (Task, error) {
	task := Task{ID: row.ID, CanvasID: row.CanvasID, ModelName: row.ModelName, Status: row.Status, Refunded: row.Refunded, CreatedAt: row.CreatedAt.UTC(), UpdatedAt: row.UpdatedAt.UTC(), Items: []Item{}}
	if err := json.Unmarshal(row.Request, &task.Input); err != nil {
		return task, fmt.Errorf("decode stored video input: %w", err)
	}
	if err := json.Unmarshal(row.Quote, &task.Quote); err != nil {
		return task, fmt.Errorf("decode stored video price: %w", err)
	}
	items, err := s.q.GetVideoTaskItems(ctx, row.ID)
	if err != nil {
		return task, fmt.Errorf("read video items: %w", err)
	}
	for _, item := range items {
		status := item.Status
		if status == "submitting" {
			status = "running"
		}
		task.Items = append(task.Items, Item{Position: item.Position, Status: status, ErrorCode: item.ErrorCode, FileID: item.FileID})
	}
	return task, nil
}

func (s *Service) Get(ctx context.Context, owner, id uuid.UUID) (Task, error) {
	row, err := s.q.VideoTaskByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && row.UserID != owner) {
		return Task{}, problem.New("VIDEO_TASK_NOT_FOUND", 404)
	}
	if err != nil {
		return Task{}, fmt.Errorf("read video task: %w", err)
	}
	return s.view(ctx, row)
}

func (s *Service) List(ctx context.Context, owner uuid.UUID, canvas *uuid.UUID, cursor string) (Page[Task], error) {
	result := Page[Task]{Items: []Task{}}
	fingerprint := pagination.Fingerprint("video-tasks", owner.String(), fmt.Sprint(canvas))
	point, err := pagination.Decode(cursor, fingerprint)
	if err != nil {
		return result, err
	}
	rows, err := s.q.ListVideoTasks(ctx, query.ListVideoTasksParams{UserID: owner, CanvasFilter: canvas, BeforeTime: point.Time, BeforeID: point.ID, PageLimit: 21})
	if err != nil {
		return result, fmt.Errorf("list video tasks: %w", err)
	}
	if len(rows) > 20 {
		rows = rows[:20]
		last := rows[19]
		result.NextCursor, err = pagination.Encode(last.CreatedAt, last.ID, fingerprint)
		if err != nil {
			return result, err
		}
	}
	for _, row := range rows {
		task, err := s.view(ctx, row)
		if err != nil {
			return result, err
		}
		result.Items = append(result.Items, task)
	}
	return result, nil
}
