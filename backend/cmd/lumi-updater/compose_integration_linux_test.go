//go:build integration

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/deployment"
)

func TestManagedComposeSwitch(t *testing.T) {
	directory := os.Getenv("LUMI_MANAGED_SMOKE_DIR")
	if directory == "" {
		t.Skip("requires a dedicated Linux Compose fixture")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 8*time.Minute)
	defer cancel()
	host, err := newCompose(directory, os.Getenv("LUMI_MANAGED_SMOKE_PROJECT"))
	if err != nil {
		t.Fatal(err)
	}
	// The isolated local registry and synthetic versions are injected by the test only.
	host.repository = os.Getenv("LUMI_MANAGED_SMOKE_IMAGE")
	host.operationLock, err = host.lock(".deployment.lock")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := host.unlockOperation(); err != nil {
			t.Error(err)
		}
	}()
	pool, err := host.connect(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	store := deployment.NewStore(pool)
	identity, err := host.Identity(ctx)
	if err != nil {
		t.Fatal(err)
	}
	schema, err := store.Schema(ctx)
	if err != nil {
		t.Fatal(err)
	}
	old := deployment.Manifest{Format: 1, Version: identity.Version, Image: deployment.Image, Digest: identity.Digest,
		Commit: identity.Commit, Platforms: []string{identity.Platform}, Schema: schema}
	next := old
	next.Version = os.Getenv("LUMI_MANAGED_SMOKE_TARGET")
	nextImage, err := host.image(ctx, host.repository+":"+next.Version)
	if err != nil {
		t.Fatal(err)
	}
	next.Digest, err = host.officialDigest(nextImage)
	if err != nil {
		t.Fatal(err)
	}
	movement := deployment.Transition{Version: old.Version, Digest: old.Digest, Schema: schema}
	next.UpgradeFrom, next.RollbackTo = []deployment.Transition{movement}, []deployment.Transition{movement}
	plan := deployment.ExecutionPlan{Source: old, Target: next, InitialSchema: schema, Platform: identity.Platform}
	if err := next.Validate(next.Version); err != nil {
		t.Fatal(err)
	}

	credentials, err := json.Marshal(map[string]string{"email": "managed-smoke@lumi.test", "password": os.Getenv("LUMI_MANAGED_SMOKE_PASSWORD")})
	if err != nil {
		t.Fatal(err)
	}
	login := func() (string, uuid.UUID) {
		t.Helper()
		output := call(t, ctx, host.client, "POST", "/api/v1/auth/login", "", "application/json", credentials)
		var session struct {
			Token string `json:"access_token"`
			User  struct {
				ID uuid.UUID `json:"id"`
			}
		}
		if err := json.Unmarshal(output, &session); err != nil || session.Token == "" || session.User.ID == uuid.Nil {
			t.Fatal("administrator login returned no session")
		}
		return session.Token, session.User.ID
	}
	token, actor := login()
	credit := []byte(`{"action":"add","bucket":"permanent","amount":37,"note":"Managed deployment smoke"}`)
	call(t, ctx, host.client, "POST", "/api/v1/admin/users/"+actor.String()+"/credits", token, "application/json", credit)
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 4, 4))); err != nil {
		t.Fatal(err)
	}
	pixel := encoded.Bytes()
	var form bytes.Buffer
	fields := multipart.NewWriter(&form)
	file, err := fields.CreateFormFile("file", "smoke.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write(pixel); err != nil {
		t.Fatal(err)
	}
	if err := fields.Close(); err != nil {
		t.Fatal(err)
	}
	var image struct {
		ID uuid.UUID `json:"id"`
	}
	uploaded := call(t, ctx, host.client, "POST", "/api/v1/files", token, fields.FormDataContentType(), form.Bytes())
	if err := json.Unmarshal(uploaded, &image); err != nil || image.ID == uuid.Nil {
		t.Fatal("expected a stored original")
	}

	for _, action := range []deployment.Action{deployment.Update, deployment.Rollback} {
		// HTTP release validation and admin enqueue are covered separately with fixed metadata.
		// Here the native host exercises the real Docker, PostgreSQL, and backup stages.
		id := uuid.New()
		if err := host.Prepare(ctx, plan); err != nil {
			t.Fatal(err)
		}
		if err := host.SavePlan(id, plan); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO deployment_jobs
			(id, actor_id, actor_ip, idempotency_key, action, source_version, source_digest, target_version, target_digest, stage)
			VALUES ($1,$2,'127.0.0.1',$3,$4,$5,$6,$7,$8,'stopping')`,
			id, actor, id.String(), action, plan.Source.Version, plan.Source.Digest, plan.Target.Version, plan.Target.Digest); err != nil {
			t.Fatal(err)
		}
		for _, stage := range []deployment.Stage{deployment.Backup, deployment.Switching, deployment.Verifying, deployment.Succeeded} {
			executor := deployment.NewExecutor(store, host)
			if err := executor.Step(ctx); err != nil {
				t.Fatal(err)
			}
			job, err := store.Get(ctx, id)
			if err != nil || job == nil || job.Stage != stage {
				t.Fatalf("expected %s after %s, got %+v %v", stage, action, job, err)
			}
		}
		for attempt := 0; ; attempt++ {
			if err := host.probe(ctx, "/", nil); err == nil {
				break
			}
			if attempt == 15 || ctx.Err() != nil {
				t.Fatal("application did not resume traffic")
			}
			time.Sleep(time.Second)
		}
		token, _ := login()
		job := call(t, ctx, host.client, "GET", "/api/v1/admin/system/deployment-jobs/"+id.String(), token, "", nil)
		if !bytes.Contains(job, []byte(`"stage":"succeeded"`)) {
			t.Fatal("API did not recover the persisted completion")
		}
		balance := call(t, ctx, host.client, "GET", "/api/v1/me/credits", token, "", nil)
		if !bytes.Contains(balance, []byte(`"permanent_balance":37`)) {
			t.Fatal("credit balance did not survive the switch")
		}
		metadata := call(t, ctx, host.client, "GET", "/api/v1/files/"+image.ID.String()+"/metadata", token, "", nil)
		var signed struct {
			URL string `json:"url"`
		}
		if err := json.Unmarshal(metadata, &signed); err != nil || !strings.HasPrefix(signed.URL, "/api/") {
			t.Fatal("signed original is missing")
		}
		if received := call(t, ctx, host.client, "GET", signed.URL, token, "", nil); !bytes.Equal(received, pixel) {
			t.Fatal("original bytes changed")
		}
		plan.Source, plan.Target = plan.Target, plan.Source
	}
}

func call(t *testing.T, ctx context.Context, client *http.Client, method, path, token, contentType string, body []byte) []byte {
	t.Helper()
	req, err := http.NewRequestWithContext(ctx, method, loopback+path, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", loopback)
	req.Header.Set("X-Lumi-CSRF", "1")
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Idempotency-Key", uuid.NewString())
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			t.Error("close fixture response")
		}
	}()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		t.Fatalf("%s fixture request returned %d", method, resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 128<<10))
	if err != nil {
		t.Fatal(err)
	}
	return data
}
