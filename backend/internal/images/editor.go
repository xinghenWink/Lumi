package images

import (
	"context"
	"errors"
	"fmt"
	"image"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/catalog"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
)

const (
	editMarkup           = "markup"
	editErase            = "erase"
	editRemoveBackground = "remove_background"
	editResize           = "resize"
)

func editRatio(ratio string) (int, int) {
	switch ratio {
	case "1:1":
		return 1, 1
	case "3:4":
		return 3, 4
	case "9:16":
		return 9, 16
	case "4:3":
		return 4, 3
	case "16:9":
		return 16, 9
	default:
		return 0, 0
	}
}

func validEditRatio(width, height int, ratio string) bool {
	x, y := editRatio(ratio)
	difference := width*y - height*x
	return width > 0 && height > 0 && x > 0 && max(difference, -difference) <= max(x, y)
}

func validateEditOptions(input Input, model catalog.PublicModel) error {
	options := input.EditOptions
	if options == nil {
		return nil
	}
	if len(input.ReferenceFileIDs) != 1 || input.Count != 1 {
		return problem.Invalid()
	}
	switch options.Action {
	case editMarkup, editErase:
		if options.GuideFileID == nil || *options.GuideFileID == uuid.Nil || *options.GuideFileID == input.ReferenceFileIDs[0] {
			return problem.Invalid()
		}
		return nil
	case editRemoveBackground:
		if !model.Capabilities.SupportsTransparentBackground {
			return problem.New("IMAGE_BACKGROUND_UNSUPPORTED", 409)
		}
	case editResize:
		var width, height int
		if _, err := fmt.Sscanf(input.Size, "%dx%d", &width, &height); err != nil || !validEditRatio(width, height, input.Ratio) {
			return problem.Invalid()
		}
	default:
		return problem.Invalid()
	}
	if options.GuideFileID != nil {
		return problem.Invalid()
	}
	return nil
}

func validateEditGuide(ctx context.Context, q *query.Queries, owner uuid.UUID, options *EditOptions, refs []query.File, limit int64) error {
	if options == nil || options.GuideFileID == nil {
		return nil
	}
	guide, err := q.GetImageEditGuide(ctx, query.GetImageEditGuideParams{ID: *options.GuideFileID, UserID: owner})
	if errors.Is(err, pgx.ErrNoRows) {
		return problem.New("FILE_NOT_FOUND", 404)
	}
	if err != nil {
		return fmt.Errorf("validate image edit guide: %w", err)
	}
	if guide.Size > min(limit, 10<<20) {
		return problem.New("FILE_TOO_LARGE", 413)
	}
	if guide.Width != refs[0].Width || guide.Height != refs[0].Height {
		return problem.New("IMAGE_EDIT_GUIDE_INVALID", 400)
	}
	return nil
}

func editPrompt(action, prompt string) string {
	switch action {
	case editMarkup:
		return "The added marks, text labels and numbered pins are editing instructions. Follow the user's instructions and omit the annotation overlay from the result.\n\n" + prompt
	case editErase:
		return "Remove the image content under the colored brush strokes and plausibly reconstruct what is behind it. Preserve the surrounding image and omit the strokes from the result.\n\n" + prompt
	case editRemoveBackground:
		return "Isolate the foreground subject on a genuinely transparent background. Preserve the subject and its edges.\n\n" + prompt
	case editResize:
		return "Recompose the image to fill the requested aspect ratio while preserving the subject and overall style.\n\n" + prompt
	default:
		return prompt
	}
}

func resultCheck(ctx context.Context, action, ratio string) func(image.Image) error {
	switch action {
	case editRemoveBackground:
		return func(img image.Image) error {
			bounds := img.Bounds()
			var transparent, visible bool
			for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
				if err := ctx.Err(); err != nil {
					return fmt.Errorf("validate transparent image: %w", err)
				}
				for x := bounds.Min.X; x < bounds.Max.X; x++ {
					_, _, _, alpha := img.At(x, y).RGBA()
					transparent = transparent || alpha == 0
					visible = visible || alpha > 0
					if transparent && visible {
						return nil
					}
				}
			}
			return problem.New("IMAGE_RESULT_NOT_TRANSPARENT", 502)
		}
	case editResize:
		return func(img image.Image) error {
			if !validEditRatio(img.Bounds().Dx(), img.Bounds().Dy(), ratio) {
				return problem.New("IMAGE_RESULT_RATIO_MISMATCH", 502)
			}
			return nil
		}
	default:
		return nil
	}
}
