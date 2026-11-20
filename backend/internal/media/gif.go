package media

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"image"
	"image/draw"
	"image/gif"
	"image/png"

	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
)

func gifColorTableBytes(flags byte) int {
	if flags&0x80 == 0 {
		return 0
	}
	return 3 * (2 << (flags & 7))
}

// skipGIFBlocks walks length-prefixed GIF sub-blocks through their terminator.
func skipGIFBlocks(raw []byte) []byte {
	for len(raw) > 0 {
		size := int(raw[0])
		raw = raw[1:]
		if size == 0 {
			return raw
		}
		if size > len(raw) {
			break
		}
		raw = raw[size:]
	}
	return nil
}

// validateGIFFrames bounds allocation before gif.DecodeAll expands the LZW data.
func validateGIFFrames(ctx context.Context, raw []byte, cfg image.Config) error {
	if len(raw) < 13 {
		return problem.New("FILE_TYPE_INVALID", 400)
	}
	start := 13 + gifColorTableBytes(raw[10])
	if start >= len(raw) {
		return problem.New("FILE_TYPE_INVALID", 400)
	}
	raw = raw[start:]
	frames := 0
	var pixels int64
	for len(raw) > 0 {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("validate GIF frames: %w", err)
		}
		block := raw[0]
		raw = raw[1:]
		switch block {
		case 0x3b:
			if frames == 0 {
				return problem.New("FILE_TYPE_INVALID", 400)
			}
			return nil
		case 0x21:
			if len(raw) == 0 {
				return problem.New("FILE_TYPE_INVALID", 400)
			}
			raw = skipGIFBlocks(raw[1:])
		case 0x2c:
			if len(raw) < 9 {
				return problem.New("FILE_TYPE_INVALID", 400)
			}
			x := int(binary.LittleEndian.Uint16(raw))
			y := int(binary.LittleEndian.Uint16(raw[2:]))
			width := int(binary.LittleEndian.Uint16(raw[4:]))
			height := int(binary.LittleEndian.Uint16(raw[6:]))
			frames++
			pixels += int64(width) * int64(height)
			if width == 0 || height == 0 || x+width > cfg.Width || y+height > cfg.Height ||
				frames > 512 || pixels > 4*maxImagePixels {
				return problem.New("FILE_DIMENSIONS_INVALID", 400)
			}
			start := 9 + gifColorTableBytes(raw[8]) + 1 // Includes the LZW minimum code size.
			if start >= len(raw) {
				return problem.New("FILE_TYPE_INVALID", 400)
			}
			raw = skipGIFBlocks(raw[start:])
		default:
			return problem.New("FILE_TYPE_INVALID", 400)
		}
	}
	return problem.New("FILE_TYPE_INVALID", 400)
}

func gifPoster(cfg image.Config, frame image.Image) image.Image {
	bounds := image.Rect(0, 0, cfg.Width, cfg.Height)
	if frame.Bounds() == bounds {
		return frame
	}
	poster := image.NewNRGBA(bounds)
	draw.Draw(poster, frame.Bounds(), frame, frame.Bounds().Min, draw.Src)
	return poster
}

func decodeGIF(ctx context.Context, raw []byte, cfg image.Config) (image.Image, error) {
	if err := validateGIFFrames(ctx, raw, cfg); err != nil {
		return nil, err
	}
	animation, err := gif.DecodeAll(bytes.NewReader(raw))
	if err != nil || len(animation.Image) == 0 {
		return nil, problem.New("FILE_TYPE_INVALID", 400)
	}
	return gifPoster(cfg, animation.Image[0]), nil
}

func (s *Store) gifReference(ctx context.Context, raw []byte) ([]byte, error) {
	select {
	case s.decodeSlots <- struct{}{}:
	case <-ctx.Done():
		return nil, fmt.Errorf("wait to decode GIF reference: %w", ctx.Err())
	}
	defer func() { <-s.decodeSlots }()
	cfg, _, err := validateImage(raw, true)
	if err != nil {
		return nil, err
	}
	frame, err := gif.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("decode GIF reference: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("prepare GIF reference: %w", err)
	}
	output := &limitedBuffer{limit: 10 << 20}
	if err := png.Encode(output, gifPoster(cfg, frame)); err != nil {
		return nil, fmt.Errorf("encode GIF reference: %w", err)
	}
	return output.Bytes(), nil
}
