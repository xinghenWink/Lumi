package catalog

import "testing"

func TestModelDisplayName(t *testing.T) {
	for _, tc := range []struct{ name, channel, want string }{
		{"Model", "", "Model"},
		{"Model", "公开渠道", "Model（公开渠道）"},
		{"Model（公开渠道）", "公开渠道", "Model（公开渠道）"},
		{"Model (公开渠道)", "公开渠道", "Model (公开渠道)"},
		{"Model (Preview)", "公开渠道", "Model (Preview)（公开渠道）"},
	} {
		if got := modelDisplayName(tc.name, tc.channel); got != tc.want {
			t.Errorf("modelDisplayName(%q, %q) = %q, want %q", tc.name, tc.channel, got, tc.want)
		}
	}
}

func TestCapabilityBoundaries(t *testing.T) {
	if !validCapabilities("chat", Capabilities{MaxContextTokens: 32768, Stream: true}) {
		t.Fatal("valid chat capabilities rejected")
	}
	for _, value := range []Capabilities{{}, {MaxN: 4, Qualities: []string{"low", "low"}, Sizes: []string{"1024x1024"}, ResponseFormat: "b64_json"}, {MaxN: 1, Qualities: []string{"low"}, Sizes: []string{"999999x1"}, ResponseFormat: "b64_json"}, {MaxN: 1, Qualities: []string{"low"}, Sizes: []string{"1024x1024"}, SupportsEdit: true, ResponseFormat: "b64_json"}} {
		if validCapabilities("image", value) {
			t.Fatalf("invalid image capabilities accepted: %+v", value)
		}
	}
	if !validCapabilities("image", Capabilities{MaxN: 4, Qualities: []string{"low", "medium", "high"}, Sizes: []string{"1024x1024", "auto"}, SupportsEdit: true, MaxReferenceImages: 4, ResponseFormat: "b64_json"}) {
		t.Fatal("valid image capabilities rejected")
	}
	if !validCapabilities("image", Capabilities{MaxN: 1, Qualities: []string{"low", "medium", "high", "xhigh", "max"}, Sizes: []string{"1024x1024"}, ResponseFormat: "b64_json"}) {
		t.Fatal("all five quality tiers must be configurable")
	}
	// The reference-image limit is an administrator choice with no fixed upper bound.
	if !validCapabilities("image", Capabilities{MaxN: 1, Qualities: []string{"low"}, Sizes: []string{"1024x1024"}, SupportsEdit: true, MaxReferenceImages: 16, ResponseFormat: "b64_json"}) {
		t.Fatal("administrator reference limit above four rejected")
	}
	if validCapabilities("image", Capabilities{MaxN: 1, Qualities: []string{"low"}, Sizes: []string{"1024x1024"}, MaxReferenceImages: -1, ResponseFormat: "b64_json"}) {
		t.Fatal("negative reference limit accepted")
	}
}

func TestSupportedImageResolutions(t *testing.T) {
	capabilities := Capabilities{UseSizePresets: true, MaxN: 1, Qualities: []string{"low"}, ResponseFormat: "b64_json"}
	for _, valid := range [][]string{nil, {"1k"}, {"1k", "2k"}, {"1k", "2k", "4k"}} {
		capabilities.SupportedResolutions = valid
		if !validCapabilities("image", capabilities) {
			t.Errorf("rejected resolutions %v", valid)
		}
	}
	for _, invalid := range [][]string{{}, {"1K"}, {"8k"}, {"1k", "1k"}} {
		capabilities.SupportedResolutions = invalid
		if validCapabilities("image", capabilities) {
			t.Errorf("accepted invalid resolutions %v", invalid)
		}
	}
	if validCapabilities("chat", Capabilities{MaxContextTokens: 1000, SupportedResolutions: []string{"1k"}}) {
		t.Fatal("accepted an image resolution on a chat model")
	}
}
