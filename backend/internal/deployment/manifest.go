package deployment

import (
	"cmp"
	"fmt"
	"regexp"
	"slices"
	"strings"
)

const (
	Repository   = "xinghenWink/Lumi"
	Image        = "ghcr.io/xinghenwink/lumi"
	ManifestName = "lumi-release.json"
)

var (
	tagPattern    = regexp.MustCompile(`^v(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$`)
	digestPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)
	commitPattern = regexp.MustCompile(`^[a-f0-9]{40}$`)
)

func Stable(tag string) bool         { return tagPattern.MatchString(tag) }
func ValidDigest(digest string) bool { return digestPattern.MatchString(digest) }

func compareTags(a, b string) int {
	parts := strings.Split(a, ".")
	for i, other := range strings.Split(b, ".") {
		if n := cmp.Compare(len(parts[i]), len(other)); n != 0 {
			return n
		}
		if n := cmp.Compare(parts[i], other); n != 0 {
			return n
		}
	}
	return 0
}

type Transition struct {
	Version string `json:"version"`
	Digest  string `json:"digest"`
	Schema  int64  `json:"schema"`
}

type Manifest struct {
	Format      int          `json:"format"`
	Version     string       `json:"version"`
	Commit      string       `json:"commit"`
	Image       string       `json:"image"`
	Digest      string       `json:"digest"`
	Platforms   []string     `json:"platforms"`
	Schema      int64        `json:"schema"`
	UpgradeFrom []Transition `json:"upgrade_from"`
	RollbackTo  []Transition `json:"rollback_to"`
}

func (m Manifest) Validate(version string) error {
	if m.Format != 1 || !Stable(version) || m.Version != version ||
		m.Image != Image || !ValidDigest(m.Digest) || !commitPattern.MatchString(m.Commit) || m.Schema < 1 {
		return fmt.Errorf("invalid release manifest for %q", version)
	}
	if len(m.Platforms) < 1 || len(m.Platforms) > 2 {
		return fmt.Errorf("invalid platform count in release %q", version)
	}
	for _, platform := range m.Platforms {
		if platform != "linux/amd64" && platform != "linux/arm64" {
			return fmt.Errorf("invalid platform in release %q", version)
		}
	}
	for _, paths := range [][]Transition{m.UpgradeFrom, m.RollbackTo} {
		for _, path := range paths {
			if !Stable(path.Version) || compareTags(path.Version, version) >= 0 ||
				!ValidDigest(path.Digest) || path.Digest == m.Digest || path.Schema < 1 {
				return fmt.Errorf("invalid transition in release %q", version)
			}
		}
	}
	return nil
}

func (m Manifest) Supports(platform string) bool {
	return slices.Contains(m.Platforms, platform)
}

func matches(paths []Transition, version, digest string, schema int64) bool {
	return slices.Contains(paths, Transition{Version: version, Digest: digest, Schema: schema})
}

func allowed(action Action, source, target Manifest, schema int64, platform string) bool {
	if !Stable(source.Version) || !Stable(target.Version) || source.Digest == target.Digest ||
		!source.Supports(platform) || !target.Supports(platform) {
		return false
	}
	switch action {
	case Update:
		return compareTags(source.Version, target.Version) < 0 &&
			matches(target.UpgradeFrom, source.Version, source.Digest, schema)
	case Rollback:
		return compareTags(source.Version, target.Version) > 0 && target.Schema <= schema &&
			matches(source.RollbackTo, target.Version, target.Digest, schema)
	default:
		return false
	}
}
