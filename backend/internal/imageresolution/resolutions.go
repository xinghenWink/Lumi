package imageresolution

import (
	"strconv"
	"strings"
)

const (
	OneK  = "1k"
	TwoK  = "2k"
	FourK = "4k"
)

type Preset struct {
	Ratio      string `json:"ratio"`
	Resolution string `json:"resolution"`
	Size       string `json:"size"`
}

func Ratios() []string { return []string{"1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"} }
func Tiers() []string  { return []string{OneK, TwoK, FourK} }

func Presets() []Preset {
	sizes := [...][3]string{
		{"1024x1024", "2048x2048", "4096x4096"},
		{"1536x1024", "2016x1344", "4032x2688"},
		{"1024x1536", "1344x2016", "2688x4032"},
		{"1024x768", "2048x1536", "4096x3072"},
		{"768x1024", "1536x2048", "3072x4096"},
		{"1280x720", "2048x1152", "3840x2160"},
		{"720x1280", "1152x2048", "2160x3840"},
	}
	ratios, resolutions := Ratios(), Tiers()
	options := make([]Preset, 0, len(ratios)*len(resolutions))
	for i, ratio := range ratios {
		for j, resolution := range resolutions {
			options = append(options, Preset{Ratio: ratio, Resolution: resolution, Size: sizes[i][j]})
		}
	}
	return options
}

// ForSize returns the tier of a validated pixel size or the billing tier for auto.
func ForSize(size string) string {
	if size == "auto" {
		return OneK
	}
	for _, preset := range Presets() {
		if preset.Size == size {
			return preset.Resolution
		}
	}
	width, height, ok := strings.Cut(size, "x")
	if !ok {
		return ""
	}
	w, widthErr := strconv.Atoi(width)
	h, heightErr := strconv.Atoi(height)
	if widthErr != nil || heightErr != nil || w < 1 || h < 1 {
		return ""
	}
	switch edge := max(w, h); {
	case edge <= 1536:
		return OneK
	case edge <= 2560:
		return TwoK
	default:
		return FourK
	}
}
