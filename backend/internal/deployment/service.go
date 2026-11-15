package deployment

import (
	"context"
	"fmt"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

type ReleaseView struct {
	Version     string    `json:"version"`
	Name        string    `json:"name"`
	Notes       string    `json:"notes"`
	URL         string    `json:"url"`
	PublishedAt time.Time `json:"published_at"`
	Current     bool      `json:"current"`
	Action      Action    `json:"action"`
	Reason      string    `json:"reason"`
}

type ReleasesView struct {
	CurrentDigest  string        `json:"current_digest"`
	Latest         *ReleaseView  `json:"latest"`
	Items          []ReleaseView `json:"items"`
	CheckedAt      *time.Time    `json:"checked_at"`
	Stale          bool          `json:"stale"`
	NextPage       int           `json:"next_page"`
	ExecutorReason string        `json:"executor_reason"`
	RecentJob      *Job          `json:"recent_job"`
}

type Service struct {
	store        *Store
	releases     *Releases
	buildVersion string
	buildCommit  string
}

func NewService(store *Store, version, commit string) *Service {
	return &Service{store: store, releases: NewReleases(), buildVersion: version, buildCommit: commit}
}

func (s *Service) Releases(ctx context.Context, page int, refresh bool) (ReleasesView, error) {
	if page < 1 || page > maxPage {
		return ReleasesView{}, problem.Invalid()
	}
	view := ReleasesView{Items: []ReleaseView{}}
	status, err := s.store.Status(ctx)
	if err != nil {
		return view, err
	}
	job, err := s.store.Recent(ctx)
	if err != nil {
		return view, err
	}
	view.RecentJob = job
	view.ExecutorReason = s.executorReason(status)
	if job != nil && (job.FinishedAt == nil || job.Stage == RecoveryRequired) {
		view.ExecutorReason = "DEPLOYMENT_BUSY"
	}
	view.CurrentDigest = status.Digest

	releaseCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	latest, latestEntry, latestErr := s.releases.latest(releaseCtx, refresh)
	list, listEntry, listErr := s.releases.list(releaseCtx, page, refresh)
	view.Stale = latestErr != nil || listErr != nil || latestEntry.stale || listEntry.stale
	if !latestEntry.checked.IsZero() {
		checked := latestEntry.checked
		if !listEntry.checked.IsZero() && listEntry.checked.Before(checked) {
			checked = listEntry.checked
		}
		view.CheckedAt = &checked
	}
	if page < maxPage && listEntry.more {
		view.NextPage = page + 1
	}

	var source Manifest
	if view.ExecutorReason == "" {
		source, err = s.releases.manifest(releaseCtx, status.Version)
		if err != nil || !sameRelease(source, status.Identity) {
			view.ExecutorReason = "DEPLOYMENT_UNVERIFIED"
		}
	}
	if latestErr == nil {
		row := newReleaseView(latest, s.buildVersion)
		switch {
		case row.Current || Stable(s.buildVersion) && compareTags(latest.Version, s.buildVersion) < 0:
		case view.ExecutorReason != "":
			row.Reason = view.ExecutorReason
		case latestEntry.stale:
			row.Reason = "DEPLOYMENT_UNVERIFIED"
		default:
			target, err := s.releases.releaseManifest(releaseCtx, latest)
			if err != nil || !allowed(Update, source, target, status.Schema, status.Platform) {
				row.Reason = "DEPLOYMENT_UNVERIFIED"
			} else {
				row.Action = Update
			}
		}
		view.Latest = &row
	}
	for _, release := range list {
		row := newReleaseView(release, s.buildVersion)
		switch {
		case row.Current:
		case view.Latest != nil && row.Version == view.Latest.Version:
			row.Action, row.Reason = view.Latest.Action, view.Latest.Reason
		case Stable(s.buildVersion) && compareTags(row.Version, s.buildVersion) >= 0:
		case view.ExecutorReason != "":
			row.Reason = view.ExecutorReason
		case listEntry.stale:
			row.Reason = "DEPLOYMENT_UNVERIFIED"
		default:
			row.Reason = "DEPLOYMENT_UNVERIFIED"
			for _, path := range source.RollbackTo {
				if path.Version != row.Version || path.Schema != status.Schema {
					continue
				}
				target, err := s.releases.releaseManifest(releaseCtx, release)
				if err == nil && target.Digest == path.Digest && allowed(Rollback, source, target, status.Schema, status.Platform) {
					row.Action, row.Reason = Rollback, ""
				}
				break
			}
		}
		view.Items = append(view.Items, row)
	}
	return view, nil
}

func newReleaseView(release Release, version string) ReleaseView {
	notes := release.Notes
	if len(notes) > 8000 {
		notes = notes[:8000]
		for !utf8.ValidString(notes) {
			notes = notes[:len(notes)-1]
		}
		notes += "…"
	}
	return ReleaseView{Version: release.Version, Current: release.Version == version, Name: release.Name, Notes: notes,
		URL: releaseURL + "/tag/" + release.Version, PublishedAt: release.PublishedAt}
}

func (s *Service) executorReason(status ExecutorStatus) string {
	switch {
	case !status.Online:
		return "DEPLOYMENT_OFFLINE"
	case status.Reason != "":
		return status.Reason
	case status.Version != s.buildVersion || status.Commit != s.buildCommit:
		return "DEPLOYMENT_CHANGED"
	default:
		return ""
	}
}

func sameRelease(manifest Manifest, identity Identity) bool {
	return manifest.Version == identity.Version && manifest.Commit == identity.Commit && manifest.Digest == identity.Digest
}

func (s *Service) Job(ctx context.Context, id uuid.UUID) (*Job, error) {
	job, err := s.store.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if job == nil {
		return nil, problem.New("NOT_FOUND", http.StatusNotFound)
	}
	return job, nil
}

func (s *Service) Enqueue(ctx context.Context, actor user.Actor, key uuid.UUID, request Request) (*Job, error) {
	if key == uuid.Nil || !Stable(request.TargetVersion) || !ValidDigest(request.CurrentDigest) ||
		(request.Action != Update && request.Action != Rollback) {
		return nil, problem.Invalid()
	}
	replayed, err := findReplay(ctx, s.store.pool, actor.ID, key, request)
	if err != nil || replayed != nil {
		return replayed, err
	}
	status, err := s.store.Status(ctx)
	if err != nil {
		return nil, err
	}
	if reason := s.executorReason(status); reason != "" {
		return nil, conflict(reason)
	}
	if status.Digest != request.CurrentDigest {
		return nil, conflict("DEPLOYMENT_CHANGED")
	}
	plan, err := s.releases.resolve(ctx, request.Action, status.Identity, request.TargetVersion, "")
	if err != nil {
		return nil, conflict("DEPLOYMENT_UNVERIFIED")
	}
	return s.store.enqueue(ctx, actor, key, request, status.Identity, plan.Target)
}

func (s *Releases) resolve(ctx context.Context, action Action, source Identity, tag, expectedDigest string) (ExecutionPlan, error) {
	if action == Update {
		latest, entry, err := s.latest(ctx, false)
		if err != nil || entry.stale || latest.Version != tag {
			return ExecutionPlan{}, fmt.Errorf("target is no longer the latest verified release")
		}
	}
	from, err := s.manifest(ctx, source.Version)
	if err != nil {
		return ExecutionPlan{}, fmt.Errorf("load source release: %w", err)
	}
	if !sameRelease(from, source) {
		return ExecutionPlan{}, fmt.Errorf("source image does not match its release")
	}
	to, err := s.manifest(ctx, tag)
	if err != nil {
		return ExecutionPlan{}, fmt.Errorf("load target release: %w", err)
	}
	if expectedDigest != "" && to.Digest != expectedDigest {
		return ExecutionPlan{}, fmt.Errorf("target image no longer matches the queued digest")
	}
	if !allowed(action, from, to, source.Schema, source.Platform) {
		return ExecutionPlan{}, fmt.Errorf("deployment transition is not verified")
	}
	return ExecutionPlan{Source: from, Target: to, InitialSchema: source.Schema, Platform: source.Platform}, nil
}
