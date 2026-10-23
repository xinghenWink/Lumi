//go:build integration

package integration_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/catalog"
	"github.com/xinghenWink/Lumi/backend/internal/images"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

func TestImagesAtomicBillingExecutionRecoveryAndFileIsolation(t *testing.T) {
	f := newAccountFixture(t)
	admin := creditActor(t, f)
	service := f.services.Images
	creditPricing(t, f, admin, 0)
	member := creditMember(t, f, admin, 10000)
	record, err := query.New(f.pool).GetUserByEmail(f.ctx, member.Email)
	if err != nil {
		t.Fatal(err)
	}
	actor := user.Actor{ID: member.ID, TokenVersion: record.TokenVersion, IP: admin.IP}
	var bitmap bytes.Buffer
	img := image.NewNRGBA(image.Rect(0, 0, 32, 24))
	img.SetNRGBA(0, 0, color.NRGBA{R: 100, A: 255})
	if err := png.Encode(&bitmap, img); err != nil {
		t.Fatal(err)
	}
	var calls, edits, downloads atomic.Int32
	key := "images-fixture-only"
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/asset.png" {
			downloads.Add(1)
			if r.Header.Get("Authorization") != "" {
				http.Error(w, "unexpected credential forwarding", 400)
				return
			}
			w.Header().Set("Content-Type", "image/png")
			if _, err := w.Write(bitmap.Bytes()); err != nil {
				return
			}
			return
		}
		if r.Header.Get("Authorization") != "Bearer "+key {
			w.WriteHeader(401)
			return
		}
		var input struct {
			Prompt string `json:"prompt"`
			Count  int    `json:"n"`
		}
		if r.URL.Path == "/v1/images/edits" {
			edits.Add(1)
			r.Body = http.MaxBytesReader(w, r.Body, 20<<20)
			reader, err := r.MultipartReader()
			if err != nil {
				w.WriteHeader(400)
				return
			}
			references := 0
			for {
				part, err := reader.NextPart()
				if err == io.EOF {
					break
				}
				if err != nil {
					w.WriteHeader(400)
					return
				}
				data, readErr := io.ReadAll(io.LimitReader(part, 1<<20))
				closeErr := part.Close()
				if readErr != nil || closeErr != nil {
					w.WriteHeader(400)
					return
				}
				if part.FormName() == "image" {
					references++
				}
				if part.FormName() == "prompt" {
					input.Prompt = string(data)
				}
			}
			input.Count = 1
			if references != 1 {
				w.WriteHeader(400)
				return
			}
		} else if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			w.WriteHeader(400)
			return
		}
		callIndex := calls.Add(1)
		if input.Prompt == "reject" || (input.Prompt == "split-partial" && callIndex%2 == 0) {
			w.WriteHeader(400)
			if _, err := fmt.Fprint(w, `{"error":{"code":"content_policy_violation","message":"private-wire-error"}}`); err != nil {
				return
			}
			return
		}
		if input.Prompt == "slow" {
			<-r.Context().Done()
			return
		}
		count := input.Count
		if input.Prompt == "partial" {
			count = 1
		}
		data := make([]map[string]string, 0, count)
		for range count {
			item := map[string]string{"b64_json": base64.StdEncoding.EncodeToString(bitmap.Bytes())}
			if input.Prompt == "url" {
				item = map[string]string{"url": server.URL + "/asset.png"}
			}
			if input.Prompt == "invalid" {
				item = map[string]string{"b64_json": base64.StdEncoding.EncodeToString([]byte("<svg/>"))}
			}
			data = append(data, item)
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{"data": data}); err != nil {
			return
		}
	}))
	defer server.Close()
	channel, err := f.services.Catalog.SaveChannel(f.ctx, admin, uuid.Nil, catalog.ChannelInput{Name: "Image fixture", BaseURL: server.URL + "/v1", APIKey: &key, TimeoutChatS: 5, TimeoutImageS: 5, Weight: 1, Enabled: true, EditFormat: "multipart"})
	if err != nil {
		t.Fatal(err)
	}
	model, err := f.services.Catalog.SaveModel(f.ctx, admin, uuid.Nil, catalog.ModelInput{DisplayName: "平台图片", Type: "image", Enabled: true, Capabilities: catalog.Capabilities{Qualities: []string{"low"}, Sizes: []string{"1024x1024", "auto"}, MaxN: 4, SupportsEdit: true, MaxReferenceImages: 4, ResponseFormat: "b64_json"}, Routes: []catalog.RouteInput{{UpstreamID: channel.ID, UpstreamModelName: "private-image-model", Weight: 1, Enabled: true}}})
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := service.Configuration(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	cfg.PerUserConcurrency = 1
	cfg.GlobalConcurrency = 1
	cfg.TimeoutSeconds = 5
	cfg, err = service.SaveConfiguration(f.ctx, admin, cfg)
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := service.CreateConversation(f.ctx, actor, uuid.New(), model.ID)
	if err != nil {
		t.Fatal(err)
	}
	input := func(prompt string, count int32) images.Input {
		return images.Input{ConversationID: conversation.ID, ModelID: model.ID, Prompt: prompt, Quality: "low", Size: "1024x1024", Count: count}
	}
	submit := func(prompt string, count int32) images.Task {
		t.Helper()
		result, err := service.Submit(f.ctx, actor, uuid.NewString(), input(prompt, count))
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	execute := func(id uuid.UUID) images.Task {
		t.Helper()
		task, claimed, err := service.Claim(f.ctx, id)
		if err != nil || !claimed {
			t.Fatalf("claim=%v error=%v", claimed, err)
		}
		service.Execute(f.ctx, task)
		result, err := service.Get(f.ctx, actor, id, false)
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	t.Run("creation and charge roll back together", func(t *testing.T) {
		before := creditBalance(t, f, actor.ID)
		if _, err := f.pool.Exec(f.ctx, "CREATE FUNCTION reject_image_task() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END; $$; CREATE TRIGGER reject_image_task BEFORE INSERT ON image_tasks FOR EACH ROW EXECUTE FUNCTION reject_image_task()"); err != nil {
			t.Fatal(err)
		}
		_, operationErr := service.Submit(f.ctx, actor, uuid.NewString(), input("rollback", 1))
		if _, err := f.pool.Exec(f.ctx, "DROP TRIGGER reject_image_task ON image_tasks; DROP FUNCTION reject_image_task()"); err != nil {
			t.Fatal(err)
		}
		after := creditBalance(t, f, actor.ID)
		if operationErr == nil || before.Total != after.Total {
			t.Fatal("task failure left a charge")
		}
	})
	var partial images.Task
	t.Run("idempotency concurrency partial result and exact refund", func(t *testing.T) {
		key := uuid.NewString()
		before := creditBalance(t, f, actor.ID)
		var group sync.WaitGroup
		ids := make(chan uuid.UUID, 8)
		failures := make(chan error, 8)
		for range 8 {
			group.Go(func() {
				task, err := service.Submit(f.ctx, actor, key, input("partial", 2))
				if err != nil {
					failures <- err
				} else {
					ids <- task.ID
				}
			})
		}
		group.Wait()
		close(ids)
		close(failures)
		for err := range failures {
			t.Fatal(err)
		}
		var id uuid.UUID
		for candidate := range ids {
			if id != uuid.Nil && candidate != id {
				t.Fatal("idempotent task duplicated")
			}
			id = candidate
		}
		if _, err := service.Submit(f.ctx, actor, key, input("changed", 2)); creditCode(err) != "IDEMPOTENCY_CONFLICT" {
			t.Fatalf("changed replay=%v", err)
		}
		second := submit("second", 1)
		claimed, ok, err := service.Claim(f.ctx, id)
		if err != nil || !ok {
			t.Fatal("first task not claimed")
		}
		if _, ok, err := service.Claim(f.ctx, second.ID); err != nil || ok {
			t.Fatalf("global capacity exceeded: %v", err)
		}
		service.Execute(f.ctx, claimed)
		partial, err = service.Get(f.ctx, actor, id, false)
		if err != nil {
			t.Fatal(err)
		}
		if partial.Status != "partial" || partial.SuccessfulImages != 1 || partial.RefundedCost != partial.UnitPrice || partial.Items[0].File == nil || partial.Items[0].File.Width != 32 {
			t.Fatalf("partial result=%+v", partial)
		}
		if _, err := service.Cancel(f.ctx, actor, second.ID); err != nil {
			t.Fatal(err)
		}
		after := creditBalance(t, f, actor.ID)
		if before.Total-after.Total != partial.UnitPrice {
			t.Fatal("partial refund did not use snapshot price")
		}
		previous := calls.Load()
		if _, err := service.Submit(f.ctx, actor, key, input("partial", 2)); err != nil || calls.Load() != previous {
			t.Fatal("replay called provider")
		}
	})
	t.Run("file links isolate owner viewer and variants", func(t *testing.T) {
		client := f.client(t)
		login := f.login(t, client, member.Email, "Integration-password-1")
		file := partial.Items[0].File
		original := f.call(t, client, "GET", file.URL, login.AccessToken, nil)
		expectStatus(t, original, 200)
		thumb := f.call(t, client, "GET", file.ThumbnailURL, login.AccessToken, nil)
		expectStatus(t, thumb, 200)
		if thumb.header.Get("Content-Type") != "image/webp" {
			t.Fatal("thumbnail is not WebP")
		}
		other := creditMember(t, f, admin, 100)
		otherClient := f.client(t)
		otherLogin := f.login(t, otherClient, other.Email, "Integration-password-1")
		expectStatus(t, f.call(t, otherClient, "GET", file.URL, otherLogin.AccessToken, nil), 404)
		expectStatus(t, f.call(t, otherClient, "DELETE", "/api/v1/me/images/"+file.ID.String(), otherLogin.AccessToken, nil), 404)
		expectStatus(t, f.call(t, client, "GET", file.URL+"tampered", login.AccessToken, nil), 404)
		if _, err := service.Get(f.ctx, user.Actor{ID: other.ID}, partial.ID, false); creditCode(err) != "IMAGE_TASK_NOT_FOUND" {
			t.Fatal("task owner escaped")
		}
	})
	t.Run("upstream rejection invalid image url and edit", func(t *testing.T) {
		for _, prompt := range []string{"reject", "invalid"} {
			task := execute(submit(prompt, 1).ID)
			if task.Status != "failed" || task.RefundedCost != task.TotalCost {
				t.Fatalf("failed task charged: %+v", task)
			}
			if prompt == "reject" && task.ErrorCode != "UPSTREAM_REJECTED" {
				t.Fatalf("rejection lost controlled code: %s", task.ErrorCode)
			}
		}
		if task := execute(submit("url", 1).ID); task.Status != "succeeded" || downloads.Load() != 1 {
			t.Fatal("same-origin image download failed")
		}
		upload, err := f.services.Files.Upload(f.ctx, actor, "upload", bitmap.Bytes(), 10<<20)
		if err != nil {
			t.Fatal(err)
		}
		request := input("edit", 1)
		request.ReferenceFileIDs = []uuid.UUID{upload.ID}
		task, err := service.Submit(f.ctx, actor, uuid.NewString(), request)
		if err != nil {
			t.Fatal(err)
		}
		if task := execute(task.ID); task.Status != "succeeded" || task.Operation != "edit" || edits.Load() != 1 {
			t.Fatal("edit did not reuse owned reference")
		}
		auto := input("automatic size", 1)
		auto.Size = "auto"
		task, err = service.Submit(f.ctx, actor, uuid.NewString(), auto)
		if err != nil {
			t.Fatal(err)
		}
		execute(task.ID)
	})
	t.Run("stop and recovery refund once and preserve healthy leases", func(t *testing.T) {
		task := submit("slow", 1)
		claimed, ok, err := service.Claim(f.ctx, task.ID)
		if err != nil || !ok {
			t.Fatal("slow claim failed")
		}
		started := calls.Load()
		done := make(chan struct{})
		go func() { defer close(done); service.Execute(f.ctx, claimed) }()
		for calls.Load() == started {
			select {
			case <-time.After(10 * time.Millisecond):
			case <-f.ctx.Done():
				t.Fatal("provider not started")
			}
		}
		if _, err := service.Cancel(f.ctx, actor, task.ID); err != nil {
			t.Fatal(err)
		}
		select {
		case <-done:
		case <-time.After(6 * time.Second):
			t.Fatal("cancel did not stop provider")
		}
		result, err := service.Get(f.ctx, actor, task.ID, false)
		if err != nil || result.Status != "canceled" || result.RefundedCost != result.TotalCost {
			t.Fatal("cancel not settled")
		}
		task = submit("recover", 1)
		claimed, ok, err = service.Claim(f.ctx, task.ID)
		if err != nil || !ok {
			t.Fatal("recovery claim failed")
		}
		if err := service.Recover(f.ctx); err != nil {
			t.Fatal(err)
		}
		if result, err := service.Get(f.ctx, actor, task.ID, false); err != nil || result.Status != "running" {
			t.Fatal("healthy task recovered")
		}
		if _, err := f.pool.Exec(f.ctx, "UPDATE image_tasks SET lease_until=now()-interval '1 second' WHERE id=$1", task.ID); err != nil {
			t.Fatal(err)
		}
		if err := service.Recover(f.ctx); err != nil {
			t.Fatal(err)
		}
		if err := service.Recover(f.ctx); err != nil {
			t.Fatal(err)
		}
		result, err = service.Get(f.ctx, actor, task.ID, false)
		if err != nil || result.Status != "failed" || result.RefundedCost != result.TotalCost {
			t.Fatal("expired task not refunded")
		}
		previous := calls.Load()
		service.Execute(f.ctx, claimed)
		if calls.Load() != previous {
			t.Fatal("delayed recovered executor called upstream")
		}
	})
	t.Run("split requests settle partial success and timeouts refund all", func(t *testing.T) {
		cfg, err = service.Configuration(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		cfg.SplitRequests = true
		if _, err := service.SaveConfiguration(f.ctx, admin, cfg); err != nil {
			t.Fatal(err)
		}
		previous := calls.Load()
		result := execute(submit("split-partial", 4).ID)
		if calls.Load()-previous != 4 || result.Status != "partial" || result.SuccessfulImages != 2 || result.RefundedCost != result.UnitPrice*2 {
			t.Fatal("split task was not settled by independent image outcomes")
		}
		result = execute(submit("slow", 1).ID)
		if result.Status != "failed" || result.RefundedCost != result.TotalCost || result.ErrorCode != "UPSTREAM_TIMEOUT" {
			t.Fatal("execution timeout was not refunded")
		}
		cfg, err = service.Configuration(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		cfg.SplitRequests = false
		if _, err := service.SaveConfiguration(f.ctx, admin, cfg); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("admin content opt-in and public DTO boundary", func(t *testing.T) {
		view, err := service.Get(f.ctx, admin, partial.ID, true)
		if err != nil || view.Prompt != "" || view.ContentVisible || view.Items[0].File != nil {
			t.Fatal("admin content visible by default")
		}
		cfg, err = service.Configuration(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		cfg.AdminCanViewContent = true
		if _, err := service.SaveConfiguration(f.ctx, admin, cfg); err != nil {
			t.Fatal(err)
		}
		view, err = service.Get(f.ctx, admin, partial.ID, true)
		if err != nil || !view.ContentVisible || view.Prompt == "" || view.Items[0].File == nil {
			t.Fatal("admin content opt-in failed")
		}
		var auditCount int
		if err := f.pool.QueryRow(f.ctx, "SELECT count(*) FROM audit_logs WHERE action='image.view'").Scan(&auditCount); err != nil || auditCount == 0 {
			t.Fatal("content view was not audited")
		}
		data, err := json.Marshal(view)
		if err != nil {
			t.Fatal(err)
		}
		for _, private := range []string{key, server.URL, "private-image-model", "private-wire-error", "request_hash", "thumbnail_path", "charge_id"} {
			if strings.Contains(string(data), private) {
				t.Fatal("private task material exposed")
			}
		}
	})
	t.Run("durable queue executes after a lost Redis delivery", func(t *testing.T) {
		task := submit("queue", 1)
		if _, err := f.cache.PopImages(f.ctx); err != nil {
			t.Fatal(err)
		}
		work, cancel := context.WithCancel(f.ctx)
		done := make(chan struct{})
		go func() { defer close(done); service.Run(work) }()
		defer func() { cancel(); <-done }()
		deadline := time.After(10 * time.Second)
		for {
			result, err := service.Get(f.ctx, actor, task.ID, false)
			if err != nil {
				t.Fatal(err)
			}
			if result.Status == "succeeded" {
				break
			}
			select {
			case <-time.After(50 * time.Millisecond):
			case <-deadline:
				t.Fatal("durable task lost after Redis delivery")
			}
		}
	})
	t.Run("avatars attach atomically and maintenance removes old orphan files", func(t *testing.T) {
		avatar, err := f.services.Files.Upload(f.ctx, actor, "avatar", bitmap.Bytes(), 2<<20)
		if err != nil || avatar.Width != 256 || avatar.Height != 256 {
			t.Fatal("avatar crop failed", err)
		}
		old, err := query.New(f.pool).GetImageFile(f.ctx, avatar.ID)
		if err != nil {
			t.Fatal(err)
		}
		replacement, err := f.services.Files.Upload(f.ctx, actor, "avatar", bitmap.Bytes(), 2<<20)
		if err != nil {
			t.Fatal(err)
		}
		owner, err := query.New(f.pool).GetUser(f.ctx, actor.ID)
		if err != nil || owner.AvatarFileID == nil || *owner.AvatarFileID != replacement.ID {
			t.Fatal("avatar was not attached")
		}
		if _, err := f.services.Files.Get(f.ctx, actor.ID, avatar.ID); err == nil {
			t.Fatal("replaced avatar remained accessible")
		}
		directory := filepath.Join(f.dataDir, "images", actor.ID.String())
		stale := filepath.Join(directory, "orphan.png.tmp")
		recent := filepath.Join(directory, "recent.png.tmp")
		for _, path := range []string{stale, recent} {
			if err := os.WriteFile(path, []byte("staging"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		earlier := time.Now().Add(-25 * time.Hour)
		if err := os.Chtimes(stale, earlier, earlier); err != nil {
			t.Fatal(err)
		}
		if err := f.services.Files.Cleanup(f.ctx, 0); err != nil {
			t.Fatal(err)
		}
		for _, path := range []string{stale, filepath.Join(f.dataDir, "images", filepath.FromSlash(old.Path))} {
			if _, err := os.Stat(path); !os.IsNotExist(err) {
				t.Fatal("old image object remained on disk", err)
			}
		}
		if _, err := os.Stat(recent); err != nil {
			t.Fatal("recent staging object was removed", err)
		}
		if _, err := f.services.Files.Get(f.ctx, actor.ID, replacement.ID); err != nil {
			t.Fatal("current avatar was removed", err)
		}
	})
	t.Run("administrator deletion works without content access and never refunds a successful image", func(t *testing.T) {
		result := execute(submit("delete-check", 1).ID)
		file := result.Items[0].File
		if file == nil {
			t.Fatal("missing deletion fixture")
		}
		cfg, err = service.Configuration(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		cfg.AdminCanViewContent = false
		if _, err := service.SaveConfiguration(f.ctx, admin, cfg); err != nil {
			t.Fatal(err)
		}
		before := creditBalance(t, f, actor.ID)
		if err := service.DeleteFile(f.ctx, admin, file.ID, true); err != nil {
			t.Fatal(err)
		}
		after := creditBalance(t, f, actor.ID)
		view, err := service.Get(f.ctx, actor, result.ID, false)
		if err != nil || view.Items[0].File != nil || view.Items[0].FileID != nil || view.RefundedCost != 0 || before.Total != after.Total {
			t.Fatal("deletion exposed a file or changed settled credits")
		}
		var count int
		if err := f.pool.QueryRow(f.ctx, "SELECT count(*) FROM audit_logs WHERE action='image.delete' AND target_id=$1", file.ID).Scan(&count); err != nil || count != 1 {
			t.Fatal("administrator deletion was not audited", err)
		}
	})
	t.Run("M6 manual refund is atomic and repeated requests cannot grant twice", func(t *testing.T) {
		result := execute(submit("manual-refund", 2).ID)
		before := creditBalance(t, f, actor.ID)
		var wait sync.WaitGroup
		for i := 0; i < 2; i++ {
			wait.Go(func() {
				if err := service.ManualRefund(f.ctx, admin, result.ID, "M6 refund fixture"); err != nil {
					t.Error(err)
				}
			})
		}
		wait.Wait()
		after := creditBalance(t, f, actor.ID)
		row, err := query.New(f.pool).GetImageTask(f.ctx, result.ID)
		if err != nil || row.RefundedCost != row.TotalCost || after.Total-before.Total != result.ActualCost {
			t.Fatalf("manual refund mismatch: %v", err)
		}
		var count int
		if err := f.pool.QueryRow(f.ctx, "SELECT count(*) FROM audit_logs WHERE action='image.refund' AND target_id=$1", result.ID).Scan(&count); err != nil || count != 1 {
			t.Fatalf("manual refund audit count=%d error=%v", count, err)
		}
	})
}
