package video

import (
	"context"
	"fmt"
	"io"
	"slices"
	"strings"
	"time"
)

type Mode string

const (
	Text       Mode = "text"
	FirstFrame Mode = "first_frame"
	FirstLast  Mode = "first_last"
	Reference  Mode = "reference"
)

type Role string

const (
	Image Role = "reference_image"
	Video Role = "reference_video"
	Audio Role = "reference_audio"
	First Role = "first_frame"
	Last  Role = "last_frame"
)

type Options struct {
	Mode          Mode   `json:"mode"`
	Ratio         string `json:"ratio"`
	Resolution    string `json:"resolution"`
	Duration      int    `json:"duration_seconds"`
	GenerateAudio bool   `json:"generate_audio"`
}

type Profile struct {
	Mode        Mode     `json:"mode"`
	Ratios      []string `json:"ratios"`
	Resolutions []string `json:"resolutions"`
	Durations   []int    `json:"durations"`
	Images      int      `json:"max_images"`
	Videos      int      `json:"max_videos"`
	Audio       int      `json:"max_audio"`
	Total       int      `json:"max_references"`
	AudioOnly   bool     `json:"allow_audio_only,omitempty"`
}

type Capabilities struct {
	Profiles []Profile `json:"profiles"`
}

func (c Capabilities) Valid() bool {
	if len(c.Profiles) == 0 || len(c.Profiles) > 32 {
		return false
	}
	for _, p := range c.Profiles {
		if !slices.Contains([]Mode{Text, FirstFrame, FirstLast, Reference}, p.Mode) ||
			!validSet(p.Ratios, []string{"adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"}) ||
			!validSet(p.Resolutions, []string{"480p", "720p", "768p", "1080p", "2k", "4k"}) ||
			len(p.Durations) == 0 || len(p.Durations) > 30 ||
			p.Images < 0 || p.Images > 30 || p.Videos < 0 || p.Videos > 10 || p.Audio < 0 || p.Audio > 10 || p.Total < 0 || p.Total > 50 {
			return false
		}
		for i, duration := range p.Durations {
			if duration < 1 || duration > 30 || slices.Contains(p.Durations[:i], duration) {
				return false
			}
		}
		if p.Mode == Reference && (p.Total == 0 || p.Images+p.Videos+p.Audio == 0 || (p.AudioOnly && p.Audio == 0)) {
			return false
		}
		if p.Mode != Reference && (p.Total != 0 || p.Images != 0 || p.Videos != 0 || p.Audio != 0 || p.AudioOnly) {
			return false
		}
	}
	return true
}

func validSet(values, allowed []string) bool {
	if len(values) == 0 || len(values) > len(allowed) {
		return false
	}
	for i, value := range values {
		if !slices.Contains(allowed, value) || slices.Contains(values[:i], value) {
			return false
		}
	}
	return true
}

func (p Profile) Supports(options Options, roles []Role) bool {
	if p.Mode != options.Mode || !slices.Contains(p.Ratios, options.Ratio) || !slices.Contains(p.Resolutions, options.Resolution) || !slices.Contains(p.Durations, options.Duration) {
		return false
	}
	counts := make(map[Role]int)
	for _, role := range roles {
		counts[role]++
	}
	switch p.Mode {
	case Text:
		return len(roles) == 0
	case FirstFrame:
		return len(roles) == 1 && counts[First] == 1
	case FirstLast:
		return len(roles) == 2 && counts[First] == 1 && counts[Last] == 1
	case Reference:
		return len(roles) > 0 && len(roles) <= p.Total && len(roles) == counts[Image]+counts[Video]+counts[Audio] &&
			counts[Image] <= p.Images && counts[Video] <= p.Videos && counts[Audio] <= p.Audio &&
			(p.AudioOnly || counts[Image]+counts[Video] > 0)
	default:
		return false
	}
}

func (c Capabilities) Supports(options Options, roles []Role) bool {
	return slices.ContainsFunc(c.Profiles, func(p Profile) bool { return p.Supports(options, roles) })
}

type ReferenceInput struct {
	Role  Role
	Token string
	URL   string
}

type Request struct {
	Model      string
	Prompt     string
	RequestID  string
	Options    Options
	References []ReferenceInput
}

type State string

const (
	Queued    State = "queued"
	Running   State = "running"
	Succeeded State = "succeeded"
	Failed    State = "failed"
)

type Snapshot struct {
	ID        string
	State     State
	ResultURL string
}

type Connection struct {
	BaseURL  string
	Key      string
	ProxyURL string
	Timeout  time.Duration
}

type Failure struct {
	Code      string
	Definite  bool
	Retryable bool
}

func (e *Failure) Error() string { return e.Code }

type Adapter interface {
	Submit(context.Context, Request) (string, error)
	Query(context.Context, string) (Snapshot, error)
	Download(context.Context, Snapshot) (io.ReadCloser, error)
}

type RecoveryAdapter interface {
	Recover(context.Context, string) (string, error)
}

type Factory func(Connection, string) (Adapter, error)

type Registry struct {
	factories map[string]Factory
	profiles  map[string][]string
}

type Binding struct {
	Protocol string   `json:"protocol"`
	Profiles []string `json:"profiles"`
}

func (r *Registry) Bindings() []Binding {
	result := make([]Binding, 0, len(r.factories))
	for protocol := range r.factories {
		result = append(result, Binding{Protocol: protocol, Profiles: append([]string{}, r.profiles[protocol]...)})
	}
	slices.SortFunc(result, func(a, b Binding) int { return strings.Compare(a.Protocol, b.Protocol) })
	return result
}

func NewRegistry(factories map[string]Factory) *Registry {
	owned := make(map[string]Factory, len(factories))
	for protocol, factory := range factories {
		owned[protocol] = factory
	}
	return &Registry{factories: owned}
}

func (r *Registry) Allows(protocol, profile string) bool {
	if _, found := r.factories[protocol]; !found {
		return false
	}
	profiles := r.profiles[protocol]
	if len(profiles) == 0 {
		return profile == ""
	}
	return slices.Contains(profiles, profile)
}

func (r *Registry) Open(protocol, profile string, connection Connection) (Adapter, error) {
	factory, ok := r.factories[protocol]
	if !ok {
		return nil, fmt.Errorf("unknown video protocol %q", protocol)
	}
	return factory(connection, profile)
}
