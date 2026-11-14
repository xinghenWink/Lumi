package images

import "testing"

func TestResolutionPresetPolicy(t *testing.T) {
	config := Configuration{
		Sizes:               []string{"1024x1024", "1536x1024", "1024x1025", "auto"},
		RatioSizes:          map[string]string{"16:9": "1536x1024"},
		DisabledRatios:      []string{"2:3"},
		DisabledResolutions: []string{"4k"},
	}
	for _, tc := range []struct {
		ratio, size string
		modelSizes  []string
		inherits    bool
		want        bool
	}{
		{"16:9", "2048x1152", nil, true, true},
		{"16:9", "2048x1536", nil, true, false},
		{"16:9", "3840x2160", nil, true, false},
		{"2:3", "1024x1536", nil, true, false},
		{"", "1024x1536", []string{"1024x1536"}, false, false},
		{"1:1", "4096x4096", []string{"4096x4096"}, false, false},
		{"", "4096x4096", []string{"4096x4096"}, false, false},
		{"1:1", "1024x1024", []string{"1024x1024"}, false, true},
		{"1:1", "2048x2048", []string{"1024x1024"}, false, false},
		{"1:1", "2048x2048", []string{"2048x2048"}, false, true},
		{"16:9", "1536x1024", []string{"1536x1024"}, false, true},
		{"", "1024x1025", []string{"1024x1025"}, false, true},
		{"", "auto", []string{"auto"}, false, true},
	} {
		if got := config.allowsSize(tc.size, tc.ratio, tc.modelSizes, tc.inherits); got != tc.want {
			t.Errorf("allowsSize(%q, %q, %v, %t) = %t, want %t", tc.size, tc.ratio, tc.modelSizes, tc.inherits, got, tc.want)
		}
	}
	for _, values := range [][]string{{"1k", "2k", "4k"}, {"2k", "2k"}, {"8k"}} {
		if validDisabled(values, presetResolutions()) {
			t.Errorf("accepted invalid disabled resolutions %v", values)
		}
	}
}

func TestConfigurationReferenceLimitIsAdministratorChoice(t *testing.T) {
	valid := Configuration{
		MaxN:                1,
		MaxReferences:       16,
		MaxUploadBytes:      1 << 20,
		Sizes:               []string{"1024x1024", "auto"},
		RatioSizes:          map[string]string{"1:1": "1024x1024"},
		PerUserConcurrency:  1,
		GlobalConcurrency:   1,
		TimeoutSeconds:      60,
		QueueTimeoutSeconds: 60,
	}
	if err := validateConfiguration(valid); err != nil {
		t.Fatalf("reference limit above four rejected: %v", err)
	}
	negative := valid
	negative.MaxReferences = -1
	if err := validateConfiguration(negative); err == nil {
		t.Fatal("negative reference limit accepted")
	}
}
