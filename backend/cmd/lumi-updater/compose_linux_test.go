package main

import (
	"strings"
	"testing"
)

func TestReplacePinPreservesDeploymentEnvironment(t *testing.T) {
	previous := "ghcr.io/xinghenwink/lumi@sha256:" + strings.Repeat("a", 64)
	target := "ghcr.io/xinghenwink/lumi@sha256:" + strings.Repeat("b", 64)
	prefix := "# original\r\nLUMI_VERSION=v0.4.0\r\n"
	suffix := "\r\nJWT_SECRET='original'\r\n"
	raw := []byte(prefix + "LUMI_IMAGE_REF=" + previous + suffix)
	updated, err := replacePin(raw, previous, target, false)
	if err != nil || string(updated) != prefix+"LUMI_IMAGE_REF="+target+suffix {
		t.Fatalf("environment bytes changed unexpectedly: %v", err)
	}
	replayed, err := replacePin(updated, previous, target, false)
	if err != nil || string(replayed) != string(updated) {
		t.Fatal("pin is not idempotent")
	}
	for _, invalid := range []string{"LUMI_IMAGE_REF='unexpected'", "export LUMI_IMAGE_REF=" + previous, "LUMI_IMAGE_REF=" + target + "\nLUMI_IMAGE_REF=" + previous} {
		if _, err := replacePin([]byte(invalid), previous, target, true); err == nil {
			t.Fatalf("accepted ambiguous pin %q", invalid)
		}
	}
}
