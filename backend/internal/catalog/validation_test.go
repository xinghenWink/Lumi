package catalog

import "testing"

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
}
