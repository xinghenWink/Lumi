package images

import (
	"slices"

	"github.com/xinghenWink/Lumi/backend/internal/imageresolution"
)

type ResolutionPreset = imageresolution.Preset

func validDisabled(values, options []string) bool {
	if len(values) >= len(options) {
		return false
	}
	for i, value := range values {
		if !slices.Contains(options, value) || slices.Contains(values[:i], value) {
			return false
		}
	}
	return true
}

func (c Configuration) allowsSize(size, ratio string, modelSizes, supportedResolutions []string, inherits bool) bool {
	if size == "auto" {
		return (ratio == "auto" || ratio == "") && !slices.Contains(c.DisabledRatios, "auto") &&
			(inherits || slices.Contains(c.Sizes, size) && slices.Contains(modelSizes, size))
	}
	if ratio == "auto" {
		return false
	}
	presets := c.ResolutionPresets
	if presets == nil {
		presets = imageresolution.Presets()
	}
	if len(supportedResolutions) > 0 && !slices.Contains(supportedResolutions, imageresolution.ForSize(size)) {
		return false
	}
	known, enabled, ratioMatches := false, false, false
	for _, preset := range presets {
		if preset.Size != size {
			continue
		}
		known = true
		if !slices.Contains(c.DisabledRatios, preset.Ratio) &&
			!slices.Contains(c.DisabledResolutions, preset.Resolution) {
			enabled = true
			ratioMatches = ratioMatches || ratio == "" || preset.Ratio == ratio
		}
	}
	if inherits {
		return ratioMatches
	}
	if !slices.Contains(modelSizes, size) {
		return false
	}
	if ratioMatches {
		return true
	}
	if !slices.Contains(c.Sizes, size) || (known && !enabled) || slices.Contains(c.DisabledRatios, ratio) {
		return false
	}
	return ratio == "" || c.RatioSizes[ratio] == size
}
