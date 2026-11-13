package images

import "testing"

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
