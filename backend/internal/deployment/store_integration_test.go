//go:build integration

package deployment

import (
	"context"
	"errors"
	"net/netip"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/user"
	"github.com/xinghenWink/Lumi/backend/migrations"
)

func TestDeploymentQueueSerializesAndAudits(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Minute)
	defer cancel()
	pg, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image: "postgres:16-alpine", ExposedPorts: []string{"5432/tcp"},
			Env:        map[string]string{"POSTGRES_USER": "lumi", "POSTGRES_DB": "lumi", "POSTGRES_PASSWORD": "deployment-integration-only"},
			WaitingFor: wait.ForLog("database system is ready to accept connections").WithOccurrence(2),
		},
		Started: true,
	})
	testcontainers.CleanupContainer(t, pg)
	if err != nil {
		t.Fatal(err)
	}
	endpoint, err := pg.PortEndpoint(ctx, "5432/tcp", "")
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.Open(ctx, "postgres://lumi:deployment-integration-only@"+endpoint+"/lumi?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := migrations.Up(ctx, pool); err != nil {
		t.Fatal(err)
	}
	store := NewStore(pool)
	plan := fixturePlan()
	source := Identity{Version: plan.Source.Version, Commit: plan.Source.Commit, Digest: plan.Source.Digest, Platform: plan.Platform, Schema: plan.InitialSchema}
	if err := store.PublishStatus(ctx, ExecutorStatus{Identity: source}); err != nil {
		t.Fatal(err)
	}

	actor := user.Actor{ID: uuid.New(), IP: netip.MustParseAddr("127.0.0.1")}
	member := user.Actor{ID: uuid.New(), IP: actor.IP}
	for role, id := range map[string]uuid.UUID{"admin": actor.ID, "user": member.ID} {
		if _, err := pool.Exec(ctx, `INSERT INTO users(id,email,password_hash,nickname,role) VALUES($1,$2,'unused',$3,$3)`,
			id, role+"@lumi.test", role); err != nil {
			t.Fatal(err)
		}
	}
	values := Request{Action: Update, TargetVersion: plan.Target.Version, CurrentDigest: source.Digest}
	key := uuid.New()
	checkProblem := func(err error, code string) {
		t.Helper()
		var p *problem.Error
		if !errors.As(err, &p) || p.Code != code {
			t.Fatalf("expected %s, got %v", code, err)
		}
	}
	_, err = store.enqueue(ctx, member, key, values, source, plan.Target)
	checkProblem(err, "FORBIDDEN")

	type result struct {
		key uuid.UUID
		job *Job
		err error
	}
	results := make(chan result, 2)
	for range 2 {
		go func() {
			key := uuid.New()
			job, err := store.enqueue(ctx, actor, key, values, source, plan.Target)
			results <- result{key: key, job: job, err: err}
		}()
	}
	first, second := <-results, <-results
	if first.err != nil {
		first, second = second, first
	}
	if first.err != nil || first.job == nil || second.job != nil {
		t.Fatalf("invalid concurrent results: %+v %+v", first, second)
	}
	checkProblem(second.err, "DEPLOYMENT_BUSY")
	replay, err := store.enqueue(ctx, actor, first.key, values, source, plan.Target)
	if err != nil || replay == nil || replay.ID != first.job.ID {
		t.Fatalf("invalid replay: %+v %v", replay, err)
	}
	changed := values
	changed.Action = Rollback
	_, err = store.enqueue(ctx, actor, first.key, changed, source, plan.Target)
	checkProblem(err, "DEPLOYMENT_CHANGED")

	if err := store.advance(ctx, first.job, RecoveryRequired, ReasonRecovery); err != nil {
		t.Fatal(err)
	}
	blocked, err := store.TrafficBlocked(ctx)
	if err != nil || !blocked {
		t.Fatalf("recovery lost the traffic gate: %v", err)
	}
	_, err = store.enqueue(ctx, actor, uuid.New(), values, source, plan.Target)
	checkProblem(err, "DEPLOYMENT_BUSY")
	final, err := store.Recent(ctx)
	if err != nil || final == nil || final.Stage != RecoveryRequired || final.FinishedAt == nil {
		t.Fatalf("missing terminal state %+v %v", final, err)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_logs WHERE target_id=$1
		AND action IN ('deployment.requested','deployment.recovery_required')`, final.ID).Scan(&count); err != nil || count != 2 {
		t.Fatalf("expected requested and terminal audit records, got %d %v", count, err)
	}
}
