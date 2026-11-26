package videos

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/pagination"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

type Asset struct {
	ID        uuid.UUID `json:"id"`
	Kind      string    `json:"kind"`
	MIME      string    `json:"mime"`
	Width     int32     `json:"width"`
	Height    int32     `json:"height"`
	Size      int64     `json:"size"`
	Duration  int64     `json:"duration_ms"`
	URL       string    `json:"url"`
	CreatedAt time.Time `json:"created_at"`
}

func validAsset(kind string) bool {
	switch kind {
	case "upload", "generated", "video_upload", "video_generated", "audio_upload":
		return true
	default:
		return false
	}
}

func (s *Service) asset(row query.File) Asset {
	expiry := time.Now().Add(15 * time.Minute).Unix()
	sig := s.files.VideoTicket(row.ID, row.UserID, "play", expiry)
	return Asset{ID: row.ID, Kind: row.Kind, MIME: row.Mime, Width: row.Width, Height: row.Height, Size: row.Size, Duration: row.DurationMs,
		URL: "/api/v1/video-media/" + row.ID.String() + "/play?owner=" + row.UserID.String() + "&expires=" + strconv.FormatInt(expiry, 10) + "&sig=" + sig, CreatedAt: row.CreatedAt.UTC()}
}

func (s *Service) Asset(ctx context.Context, owner, id uuid.UUID) (Asset, error) {
	row, err := s.files.Get(ctx, owner, id)
	if err != nil {
		return Asset{}, err
	}
	if !validAsset(row.Kind) {
		return Asset{}, problem.New("FILE_NOT_FOUND", 404)
	}
	return s.asset(row), nil
}

func (s *Service) Assets(ctx context.Context, owner uuid.UUID, cursor string) (Page[Asset], error) {
	result := Page[Asset]{Items: []Asset{}}
	fingerprint := pagination.Fingerprint("video-assets", owner.String())
	point, err := pagination.Decode(cursor, fingerprint)
	if err != nil {
		return result, err
	}
	rows, err := s.q.ListVideoAssets(ctx, query.ListVideoAssetsParams{UserID: owner, BeforeTime: point.Time, BeforeID: point.ID, PageLimit: 31})
	if err != nil {
		return result, fmt.Errorf("list video assets: %w", err)
	}
	if len(rows) > 30 {
		rows = rows[:30]
		last := rows[29]
		result.NextCursor, err = pagination.Encode(last.CreatedAt, last.ID, fingerprint)
		if err != nil {
			return result, err
		}
	}
	for _, row := range rows {
		result.Items = append(result.Items, s.asset(row))
	}
	return result, nil
}

func (s *Service) Upload(ctx context.Context, actor user.Actor, kind string, reader io.Reader) (Asset, error) {
	if kind == "image" {
		data, err := io.ReadAll(io.LimitReader(reader, (10<<20)+1))
		if err != nil {
			return Asset{}, fmt.Errorf("read video image upload: %w", err)
		}
		file, err := s.files.Upload(ctx, actor, "upload", data, 10<<20)
		if err != nil {
			return Asset{}, err
		}
		return s.Asset(ctx, actor.ID, file.ID)
	}
	limit, storedKind := MaxVideoUpload, "video_upload"
	if kind == "audio" {
		limit, storedKind = MaxAudioUpload, "audio_upload"
	} else if kind != "video" {
		return Asset{}, problem.Invalid()
	}
	prepared, err := s.files.PrepareAV(ctx, actor.ID, nil, reader, storedKind, int64(limit), false)
	if err != nil {
		return Asset{}, err
	}
	var row query.File
	err = db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		active, err := q.GetUserForUpdate(ctx, actor.ID)
		if err != nil {
			return fmt.Errorf("lock media owner: %w", err)
		}
		if active.Status != "active" || active.TokenVersion != actor.TokenVersion {
			return problem.Unauthorized()
		}
		row, err = q.InsertImageFile(ctx, prepared.Params)
		if err != nil {
			return fmt.Errorf("store video reference: %w", err)
		}
		row.DurationMs = prepared.Duration
		if err := q.SetFileDuration(ctx, query.SetFileDurationParams{ID: row.ID, DurationMs: row.DurationMs}); err != nil {
			return fmt.Errorf("store media duration: %w", err)
		}
		return nil
	})
	if err != nil {
		return Asset{}, errors.Join(err, s.files.Discard(prepared.Params))
	}
	return s.asset(row), nil
}

func (s *Service) Media(ctx context.Context, id, scope uuid.UUID, kind string, expires int64, sig string) (query.File, error) {
	missing := problem.New("FILE_NOT_FOUND", 404)
	if (kind != "play" && kind != "reference") || !s.files.VerifyVideoTicket(id, scope, kind, expires, sig) {
		return query.File{}, missing
	}
	row, err := s.files.GetForAdmin(ctx, id)
	if err != nil {
		return row, err
	}
	if !validAsset(row.Kind) || (kind == "play" && row.UserID != scope) {
		return query.File{}, missing
	}
	if kind == "reference" {
		active, err := s.q.ActiveVideoReference(ctx, query.ActiveVideoReferenceParams{ID: scope, FileID: id})
		if err != nil {
			return row, fmt.Errorf("check video reference ticket: %w", err)
		}
		if !active {
			return query.File{}, missing
		}
	}
	return row, nil
}
