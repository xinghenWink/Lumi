//go:build integration

package integration_test

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	platformredis "github.com/xinghenWink/Lumi/backend/internal/platform/redis"
	"github.com/xinghenWink/Lumi/backend/migrations"
)

func TestInfrastructure(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Minute)
	defer cancel()
	postgres, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image: "postgres:16-alpine", ExposedPorts: []string{"5432/tcp"},
			Env:        map[string]string{"POSTGRES_USER": "lumi", "POSTGRES_PASSWORD": "integration-only", "POSTGRES_DB": "lumi"},
			WaitingFor: wait.ForLog("database system is ready to accept connections").WithOccurrence(2),
		}, Started: true,
	})
	testcontainers.CleanupContainer(t, postgres)
	if err != nil {
		t.Fatalf("start PostgreSQL (Docker is required): %v", err)
	}
	postgresAddress, err := postgres.PortEndpoint(ctx, "5432/tcp", "")
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.Open(ctx, "postgres://lumi:integration-only@"+postgresAddress+"/lumi?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	// Concurrent startup must serialize migrations using the PostgreSQL lock.
	var group sync.WaitGroup
	errors := make(chan error, 2)
	for range 2 {
		group.Go(func() { errors <- migrations.Up(ctx, pool) })
	}
	group.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatalf("concurrent migrations: %v", err)
		}
	}
	if err := migrations.Up(ctx, pool); err != nil {
		t.Fatalf("repeat migration: %v", err)
	}
	var count int
	for _, version := range []int64{1, 2, 3, 4} {
		if err := pool.QueryRow(ctx, "SELECT count(*) FROM public.goose_db_version WHERE version_id = $1 AND is_applied", version).Scan(&count); err != nil || count != 1 {
			t.Fatalf("migration %d version count = %d, error = %v", version, count, err)
		}
	}
	var stableSchema bool
	if err := pool.QueryRow(ctx, "SELECT current_schema() = 'lumi' AND to_regclass('lumi.users') IS NOT NULL AND to_regclass('lumi.goose_db_version') IS NULL").Scan(&stableSchema); err != nil || !stableSchema {
		t.Fatalf("migration schema changed or shadowed its version table: stable=%v error=%v", stableSchema, err)
	}
	if alive, err := query.New(pool).Ping(ctx); err != nil || alive != 1 {
		t.Fatalf("generated query = %d, error = %v", alive, err)
	}

	cache, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image: "redis:7-alpine", ExposedPorts: []string{"6379/tcp"},
			Cmd:        []string{"redis-server", "--requirepass", "integration-only"},
			WaitingFor: wait.ForLog("Ready to accept connections"),
		}, Started: true,
	})
	testcontainers.CleanupContainer(t, cache)
	if err != nil {
		t.Fatalf("start Redis: %v", err)
	}
	cacheAddress, err := cache.PortEndpoint(ctx, "6379/tcp", "")
	if err != nil {
		t.Fatal(err)
	}
	client, err := platformredis.Open(ctx, fmt.Sprintf("redis://:integration-only@%s/0", cacheAddress))
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := client.Close(); err != nil {
			t.Errorf("close Redis: %v", err)
		}
	}()
	if err := client.Ping(ctx); err != nil {
		t.Fatalf("ping Redis: %v", err)
	}
	if err := cache.Stop(ctx, nil); err != nil {
		t.Fatalf("stop Redis: %v", err)
	}
	if err := client.Ping(ctx); err == nil {
		t.Fatal("Redis outage incorrectly reported healthy")
	}
}
