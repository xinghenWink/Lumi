package images

import "slices"

type ResolutionPreset struct {
	Ratio      string `json:"ratio"`
	Resolution string `json:"resolution"`
	Size       string `json:"size"`
}

func presetRatios() []string      { return []string{"1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"} }
func presetResolutions() []string { return []string{"1k", "2k", "4k"} }

func defaultResolutionPresets() []ResolutionPreset {
	sizes := [...][3]string{
		{"1024x1024", "2048x2048", "4096x4096"},
		{"1536x1024", "2016x1344", "4032x2688"},
		{"1024x1536", "1344x2016", "2688x4032"},
		{"1024x768", "2048x1536", "4096x3072"},
		{"768x1024", "1536x2048", "3072x4096"},
		{"1280x720", "2048x1152", "3840x2160"},
		{"720x1280", "1152x2048", "2160x3840"},
	}
	ratios, resolutions := presetRatios(), presetResolutions()
	options := make([]ResolutionPreset, 0, len(ratios)*len(resolutions))
	for i, ratio := range ratios {
		for j, resolution := range resolutions {
			options = append(options, ResolutionPreset{Ratio: ratio, Resolution: resolution, Size: sizes[i][j]})
		}
	}
	return options
}

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

func (c Configuration) allowsSize(size, ratio string, modelSizes []string, inherits bool) bool {
	presets := c.ResolutionPresets
	if presets == nil {
		presets = defaultResolutionPresets()
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
	return ratio == "" || c.RatioSizes[ratio] == size && size != "auto"
}
