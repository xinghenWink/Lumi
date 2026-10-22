package media

import (
	"bytes"
	"context"
	"fmt"
	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"golang.org/x/image/draw"
	"image"
	"image/png"
	"io"
	"io/fs"
)

func (s *Store) Usage(ctx context.Context) (int64, error) {
	var total int64
	err := fs.WalkDir(s.root.FS(), ".", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode().IsRegular() {
			total += info.Size()
		}
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("measure image storage: %w", err)
	}
	return total, nil
}

// VisionReference bounds wire and memory usage independently of the uploaded original.
func (s *Store) VisionReference(ctx context.Context, owner, id uuid.UUID) ([]byte, error) {
	return s.VisionReferenceTx(ctx, s.q, owner, id)
}

// VisionReferenceTx never acquires a second connection inside chat preparation.
func (s *Store) VisionReferenceTx(ctx context.Context, q *query.Queries, owner, id uuid.UUID) ([]byte, error) {
	row, err := s.GetTx(ctx, q, owner, id)
	if err != nil {
		return nil, err
	}
	file, _, err := s.Open(ctx, row, true)
	if err != nil {
		return nil, err
	}
	raw, readErr := io.ReadAll(io.LimitReader(file, 2<<20+1))
	closeErr := file.Close()
	if readErr != nil {
		return nil, fmt.Errorf("read vision thumbnail: %w", readErr)
	}
	if closeErr != nil {
		return nil, fmt.Errorf("close vision thumbnail: %w", closeErr)
	}
	if len(raw) > 2<<20 {
		return nil, problem.New("FILE_TOO_LARGE", 413)
	}
	source, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("decode vision thumbnail: %w", err)
	}
	width, height := source.Bounds().Dx(), source.Bounds().Dy()
	if width > 256 || height > 256 {
		if width >= height {
			height = max(1, height*256/width)
			width = 256
		} else {
			width = max(1, width*256/height)
			height = 256
		}
	}
	target := image.NewNRGBA(image.Rect(0, 0, width, height))
	draw.ApproxBiLinear.Scale(target, target.Bounds(), source, source.Bounds(), draw.Src, nil)
	var output bytes.Buffer
	if err := png.Encode(&output, target); err != nil {
		return nil, fmt.Errorf("encode vision thumbnail: %w", err)
	}
	return output.Bytes(), nil
}
