package deployment

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func fixturePlan() ExecutionPlan {
	source := Manifest{Format: 1, Version: "v0.4.0", Image: Image, Schema: 14, Platforms: []string{"linux/amd64"},
		Digest: "sha256:" + strings.Repeat("a", 64), Commit: strings.Repeat("c", 40)}
	target := Manifest{Format: 1, Version: "v0.5.0", Image: Image, Schema: 15, Platforms: []string{"linux/amd64"},
		Digest: "sha256:" + strings.Repeat("b", 64), Commit: strings.Repeat("d", 40),
		UpgradeFrom: []Transition{{Version: source.Version, Digest: source.Digest, Schema: 14}},
		RollbackTo:  []Transition{{Version: source.Version, Digest: source.Digest, Schema: 15}}}
	return ExecutionPlan{Source: source, Target: target, InitialSchema: 14, Platform: "linux/amd64"}
}

type testStore struct {
	job    Job
	schema int64
}

func (s *testStore) Active(context.Context) (*Job, error)                { return &s.job, nil }
func (s *testStore) Schema(context.Context) (int64, error)               { return s.schema, nil }
func (s *testStore) PublishStatus(context.Context, ExecutorStatus) error { return nil }
func (s *testStore) advance(_ context.Context, _ *Job, stage Stage, reason string) error {
	s.job.Stage, s.job.Reason = stage, reason
	return nil
}

type testRuntime struct {
	plan       ExecutionPlan
	store      *testStore
	operations []string
	failBackup bool
	failBoot   bool
}

func (r *testRuntime) Identity(context.Context) (Identity, error) {
	return Identity{Version: r.plan.Source.Version, Commit: r.plan.Source.Commit, Digest: r.plan.Source.Digest,
		Platform: r.plan.Platform}, nil
}

func (r *testRuntime) Prepare(context.Context, ExecutionPlan) error {
	r.operations = append(r.operations, "pull")
	return nil
}
func (r *testRuntime) SavePlan(_ uuid.UUID, plan ExecutionPlan) error {
	r.plan = plan
	return nil
}
func (r *testRuntime) LoadPlan(uuid.UUID) (ExecutionPlan, error) { return r.plan, nil }
func (r *testRuntime) Stop(context.Context, ExecutionPlan) error {
	r.operations = append(r.operations, "stop")
	return nil
}
func (r *testRuntime) Backup(context.Context, uuid.UUID, ExecutionPlan) error {
	r.operations = append(r.operations, "backup")
	if r.failBackup {
		return errors.New("backup failed")
	}
	return nil
}
func (r *testRuntime) Pin(_ context.Context, _ Manifest, manifest Manifest) error {
	r.operations = append(r.operations, "pin "+manifest.Version)
	return nil
}
func (r *testRuntime) Start(_ context.Context, _ Manifest, manifest Manifest, _ string) error {
	r.operations = append(r.operations, "start "+manifest.Version)
	if manifest.Version == r.plan.Target.Version {
		r.store.schema = r.plan.Target.Schema
		if r.failBoot {
			return errors.New("target startup failed")
		}
	}
	return nil
}

func TestExecutorStagesAndRecovery(t *testing.T) {
	tests := []struct {
		name                         string
		failBackup, failBoot, unsafe bool
		want                         Stage
		operations                   []string
	}{
		{name: "update", want: Succeeded, operations: []string{"pull", "stop", "backup", "pin v0.5.0", "start v0.5.0"}},
		{name: "backup failure", failBackup: true, want: Failed, operations: []string{"pull", "stop", "backup", "stop", "pin v0.4.0", "start v0.4.0"}},
		{name: "verified fallback", failBoot: true, want: RolledBack, operations: []string{"pull", "stop", "backup", "pin v0.5.0", "start v0.5.0", "stop", "pin v0.4.0", "start v0.4.0"}},
		{name: "migration requires recovery", failBoot: true, unsafe: true, want: RecoveryRequired, operations: []string{"pull", "stop", "backup", "pin v0.5.0", "start v0.5.0", "stop"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			plan := fixturePlan()
			if test.unsafe {
				plan.Target.RollbackTo = nil
			}
			store := &testStore{schema: 14, job: Job{ID: uuid.New(), Stage: Queued, Action: Update, SourceVersion: plan.Source.Version,
				SourceDigest: plan.Source.Digest, TargetVersion: plan.Target.Version, TargetDigest: plan.Target.Digest}}
			runtime := &testRuntime{plan: plan, store: store, failBackup: test.failBackup, failBoot: test.failBoot}
			resolve := func(context.Context, Action, Identity, string, string) (ExecutionPlan, error) { return plan, nil }
			for attempts := 0; attempts < 10 && !store.job.Stage.terminal(); attempts++ {
				// A new executor at every step must continue from the durable stage and journal.
				executor := &Executor{store: store, runtime: runtime, resolve: resolve}
				if err := executor.Step(t.Context()); err != nil {
					t.Fatal(err)
				}
			}
			if store.job.Stage != test.want || !slices.Equal(runtime.operations, test.operations) {
				t.Fatalf("got %s %v, want %s %v", store.job.Stage, runtime.operations, test.want, test.operations)
			}
		})
	}
}

func TestTransitionsRequireExactDigestSchemaAndPlatform(t *testing.T) {
	plan := fixturePlan()
	if !allowed(Update, plan.Source, plan.Target, 14, plan.Platform) ||
		!allowed(Rollback, plan.Target, plan.Source, 15, plan.Platform) {
		t.Fatal("expected verified paths")
	}
	foreign := plan.Source
	foreign.Digest = "sha256:" + strings.Repeat("e", 64)
	if allowed(Update, foreign, plan.Target, 14, plan.Platform) ||
		allowed(Rollback, plan.Target, plan.Source, 16, plan.Platform) ||
		allowed(Update, plan.Source, plan.Target, 14, "linux/arm64") {
		t.Fatal("unverified path allowed")
	}
}
