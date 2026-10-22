package media

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/HugoSmits86/nativewebp"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/user"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

type File struct {
	ID              uuid.UUID `json:"id"`
	Kind            string    `json:"kind"`
	MIME            string    `json:"mime"`
	Size            int64     `json:"size"`
	Width           int32     `json:"width"`
	Height          int32     `json:"height"`
	ThumbnailWidth  int32     `json:"thumbnail_width"`
	ThumbnailHeight int32     `json:"thumbnail_height"`
	URL             string    `json:"url"`
	ThumbnailURL    string    `json:"thumbnail_url"`
	ExpiresAt       int64     `json:"expires_at"`
	CreatedAt       time.Time `json:"created_at"`
}
type Store struct {
	pool        *pgxpool.Pool
	q           *query.Queries
	root        *os.Root
	key         []byte
	decodeSlots chan struct{}
}

func New(pool *pgxpool.Pool, directory string, key []byte) (*Store, error) {
	if directory == "" || len(key) < 32 {
		return nil, fmt.Errorf("invalid image storage configuration")
	}
	path, err := filepath.Abs(filepath.Join(directory, "images"))
	if err != nil {
		return nil, fmt.Errorf("resolve image directory: %w", err)
	}
	if err := os.MkdirAll(path, 0700); err != nil {
		return nil, fmt.Errorf("create image directory: %w", err)
	}
	root, err := os.OpenRoot(path)
	if err != nil {
		return nil, fmt.Errorf("open image directory: %w", err)
	}
	return &Store{pool: pool, q: query.New(pool), root: root, key: append([]byte(nil), key...), decodeSlots: make(chan struct{}, 2)}, nil
}
func (s *Store) Close() error { return s.root.Close() }
func (s *Store) signed(id, viewer uuid.UUID, variant string, expires int64) string {
	mac := hmac.New(sha256.New, s.key)
	if _, err := fmt.Fprintf(mac, "image-v1:%s:%s:%s:%d", id, viewer, variant, expires); err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func (s *Store) Decorate(file File, viewer uuid.UUID) File {
	expires := (time.Now().Unix()/900 + 4) * 900
	base := "/api/v1/files/" + file.ID.String()
	file.URL = base + "?expires=" + strconv.FormatInt(expires, 10) + "&sig=" + s.signed(file.ID, viewer, "original", expires)
	file.ThumbnailURL = base + "/thumb?expires=" + strconv.FormatInt(expires, 10) + "&sig=" + s.signed(file.ID, viewer, "thumb", expires)
	file.ExpiresAt = expires
	return file
}
func (s *Store) View(row query.File, viewer uuid.UUID) File {
	return s.Decorate(File{ID: row.ID, Kind: row.Kind, MIME: row.Mime, Size: row.Size, Width: row.Width, Height: row.Height, ThumbnailWidth: row.ThumbnailWidth, ThumbnailHeight: row.ThumbnailHeight, CreatedAt: row.CreatedAt.UTC()}, viewer)
}
func (s *Store) Verify(id, viewer uuid.UUID, thumb bool, expires int64, sig string) bool {
	now := time.Now().Unix()
	if expires < now || expires > now+3600 {
		return false
	}
	variant := "original"
	if thumb {
		variant = "thumb"
	}
	expected := s.signed(id, viewer, variant, expires)
	return expected != "" && hmac.Equal([]byte(expected), []byte(sig))
}
func (s *Store) Get(ctx context.Context, owner, id uuid.UUID) (query.File, error) {
	row, err := s.q.GetImageFile(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && row.UserID != owner) {
		return query.File{}, problem.New("FILE_NOT_FOUND", 404)
	}
	if err != nil {
		return query.File{}, fmt.Errorf("read file metadata: %w", err)
	}
	return row, nil
}
func (s *Store) GetForAdmin(ctx context.Context, id uuid.UUID) (query.File, error) {
	row, err := s.q.GetImageFile(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return row, problem.New("FILE_NOT_FOUND", 404)
	}
	if err != nil {
		return row, fmt.Errorf("read managed file: %w", err)
	}
	return row, nil
}

type limitedBuffer struct {
	bytes.Buffer
	limit int64
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if int64(b.Len())+int64(len(p)) > b.limit {
		return 0, problem.New("FILE_TOO_LARGE", 413)
	}
	return b.Buffer.Write(p)
}
func validateImage(raw []byte) (image.Config, error) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || (format != "jpeg" && format != "png" && format != "webp") {
		return image.Config{}, problem.New("FILE_TYPE_INVALID", 400)
	}
	if cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 8192 || cfg.Height > 8192 || int64(cfg.Width)*int64(cfg.Height) > 24_000_000 {
		return image.Config{}, problem.New("FILE_DIMENSIONS_INVALID", 400)
	}
	return cfg, nil
}
func (s *Store) Prepare(ctx context.Context, owner uuid.UUID, task *uuid.UUID, kind string, raw []byte, limit int64) (query.InsertImageFileParams, error) {
	var result query.InsertImageFileParams
	if err := ctx.Err(); err != nil {
		return result, err
	}
	if (kind != "upload" && kind != "generated" && kind != "avatar") || limit < 1 || limit > 20<<20 || len(raw) == 0 || int64(len(raw)) > limit {
		return result, problem.New("FILE_TOO_LARGE", 413)
	}
	select {
	case s.decodeSlots <- struct{}{}:
	case <-ctx.Done():
		return result, ctx.Err()
	}
	defer func() { <-s.decodeSlots }()
	if _, err := validateImage(raw); err != nil {
		return result, err
	}
	decoded, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return result, problem.New("FILE_TYPE_INVALID", 400)
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	bounds := decoded.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if kind == "avatar" {
		dest := image.NewNRGBA(image.Rect(0, 0, 256, 256))
		side := min(width, height)
		left, top := bounds.Min.X+(width-side)/2, bounds.Min.Y+(height-side)/2
		draw.ApproxBiLinear.Scale(dest, dest.Bounds(), decoded, image.Rect(left, top, left+side, top+side), draw.Src, nil)
		decoded = dest
		width, height = 256, 256
	}
	output := &limitedBuffer{limit: limit}
	if err := png.Encode(output, decoded); err != nil {
		return result, fmt.Errorf("normalize image: %w", err)
	}
	tw, th := width, height
	if max(tw, th) > 512 {
		tw = max(1, width*512/max(width, height))
		th = max(1, height*512/max(width, height))
	}
	thumbnail := image.NewNRGBA(image.Rect(0, 0, tw, th))
	draw.ApproxBiLinear.Scale(thumbnail, thumbnail.Bounds(), decoded, decoded.Bounds(), draw.Src, nil)
	var thumb bytes.Buffer
	if err := nativewebp.Encode(&thumb, thumbnail, nil); err != nil {
		return result, fmt.Errorf("encode thumbnail: %w", err)
	}
	id, err := validation.NewID()
	if err != nil {
		return result, err
	}
	directory := owner.String()
	if err := s.root.MkdirAll(directory, 0700); err != nil {
		return result, fmt.Errorf("create image owner directory: %w", err)
	}
	path := directory + "/" + id.String() + ".png"
	thumbnailPath := directory + "/" + id.String() + ".webp"
	if err := s.write(path, output.Bytes()); err != nil {
		return result, err
	}
	if err := s.write(thumbnailPath, thumb.Bytes()); err != nil {
		return result, errors.Join(err, s.remove(path))
	}
	hash := sha256.Sum256(output.Bytes())
	return query.InsertImageFileParams{ID: id, UserID: owner, Kind: kind, TaskID: task, Path: path, ThumbnailPath: thumbnailPath, Size: int64(output.Len()), Width: int32(width), Height: int32(height), ThumbnailWidth: int32(tw), ThumbnailHeight: int32(th), Sha256: hex.EncodeToString(hash[:])}, nil
}
func (s *Store) write(path string, data []byte) error {
	temp := path + ".tmp"
	f, err := s.root.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return fmt.Errorf("create image staging file: %w", err)
	}
	_, writeErr := f.Write(data)
	if writeErr == nil {
		writeErr = f.Sync()
	}
	closeErr := f.Close()
	if err := errors.Join(writeErr, closeErr); err != nil {
		return errors.Join(fmt.Errorf("write image staging file: %w", err), s.remove(temp))
	}
	if err := s.root.Rename(temp, path); err != nil {
		return errors.Join(fmt.Errorf("publish image file: %w", err), s.remove(temp))
	}
	return nil
}
func (s *Store) remove(path string) error {
	if err := s.root.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove image object: %w", err)
	}
	return nil
}
func (s *Store) Discard(file query.InsertImageFileParams) error {
	return errors.Join(s.remove(file.Path), s.remove(file.ThumbnailPath))
}
func (s *Store) Upload(ctx context.Context, actor user.Actor, kind string, data []byte, limit int64) (File, error) {
	prepared, err := s.Prepare(ctx, actor.ID, nil, kind, data, limit)
	if err != nil {
		return File{}, err
	}
	var row query.File
	err = db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		owner, err := q.GetUserForUpdate(ctx, actor.ID)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && (owner.Status != "active" || owner.TokenVersion != actor.TokenVersion)) {
			return problem.Unauthorized()
		}
		if err != nil {
			return fmt.Errorf("lock upload owner: %w", err)
		}
		row, err = q.InsertImageFile(ctx, prepared)
		if err != nil {
			return fmt.Errorf("save upload metadata: %w", err)
		}
		return nil
	})
	if err != nil {
		return File{}, errors.Join(err, s.Discard(prepared))
	}
	return s.View(row, actor.ID), nil
}
func (s *Store) Open(ctx context.Context, row query.File, thumb bool) (*os.File, string, error) {
	if err := ctx.Err(); err != nil {
		return nil, "", err
	}
	path, mime := row.Path, row.Mime
	if thumb {
		path, mime = row.ThumbnailPath, "image/webp"
	}
	file, err := s.root.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, "", problem.New("FILE_NOT_FOUND", 404)
		}
		return nil, "", fmt.Errorf("open image object: %w", err)
	}
	return file, mime, nil
}
func (s *Store) Reference(ctx context.Context, owner, id uuid.UUID) ([]byte, error) {
	row, err := s.Get(ctx, owner, id)
	if err != nil {
		return nil, err
	}
	file, _, err := s.Open(ctx, row, false)
	if err != nil {
		return nil, err
	}
	data, readErr := io.ReadAll(io.LimitReader(file, 10<<20+1))
	closeErr := file.Close()
	if err := errors.Join(readErr, closeErr); err != nil {
		return nil, fmt.Errorf("read reference image: %w", err)
	}
	if len(data) > 10<<20 {
		return nil, problem.New("FILE_TOO_LARGE", 413)
	}
	return data, nil
}
func (s *Store) Cleanup(ctx context.Context, days int32) error {
	if _, err := s.q.ExpireImageFiles(ctx, days); err != nil {
		return fmt.Errorf("expire image files: %w", err)
	}
	rows, err := s.q.PendingImageFilesCleanup(ctx)
	if err != nil {
		return fmt.Errorf("list deleted images: %w", err)
	}
	for _, row := range rows {
		if err := errors.Join(s.remove(row.Path), s.remove(row.ThumbnailPath)); err != nil {
			return err
		}
		if err := s.q.MarkImageFilePurged(ctx, row.ID); err != nil {
			return fmt.Errorf("mark image removed: %w", err)
		}
	}
	if err := s.q.RedactPurgedImageOwners(ctx); err != nil {
		return fmt.Errorf("redact purged image owners: %w", err)
	}
	return nil
}
