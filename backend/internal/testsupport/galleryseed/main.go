//go:build integration

// Command galleryseed copies a real normalized image into an isolated performance gallery.
package main

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func seed(ctx context.Context) error {
	source := os.Getenv("E2E_DATABASE_URL")
	parsed, err := url.Parse(source)
	if err != nil || os.Getenv("APP_ENV") != "test" || parsed == nil || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") {
		return fmt.Errorf("explicit loopback test database required")
	}
	owner, err := uuid.Parse(os.Getenv("E2E_IMAGE_USER_ID"))
	if err != nil {
		return fmt.Errorf("test owner required: %w", err)
	}
	connection, err := pgx.Connect(ctx, source)
	if err != nil {
		return fmt.Errorf("connect fixture: %w", err)
	}
	defer func() {
		if err := connection.Close(ctx); err != nil {
			fmt.Fprintln(os.Stderr, "fixture connection close failed")
		}
	}()
	var email string
	if err := connection.QueryRow(ctx, "SELECT email FROM lumi.users WHERE id=$1 AND deleted_at IS NULL", owner).Scan(&email); err != nil || !strings.HasSuffix(email, "@lumi.test") {
		return fmt.Errorf("existing test owner required")
	}
	var original, thumbnail string
	var template uuid.UUID
	if err := connection.QueryRow(ctx, "SELECT id,path,thumbnail_path FROM lumi.files WHERE user_id=$1 AND kind='generated' AND deleted_at IS NULL LIMIT 1", owner).Scan(&template, &original, &thumbnail); err != nil {
		return fmt.Errorf("real generated file required: %w", err)
	}
	root, err := os.OpenRoot(filepath.Join(os.Getenv("E2E_DATA_DIR"), "images"))
	if err != nil {
		return fmt.Errorf("open fixture storage: %w", err)
	}
	defer func() {
		if err := root.Close(); err != nil {
			fmt.Fprintln(os.Stderr, "fixture storage close failed")
		}
	}()
	raw, err := root.ReadFile(original)
	if err != nil {
		return err
	}
	thumb, err := root.ReadFile(thumbnail)
	if err != nil {
		return err
	}
	if err := root.Mkdir("m7-fixture", 0700); err != nil && !errors.Is(err, os.ErrExist) {
		return err
	}
	transaction, err := connection.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		if err := transaction.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			fmt.Fprintln(os.Stderr, "fixture rollback failed")
		}
	}()
	var count int
	if err := transaction.QueryRow(ctx, "SELECT count(*) FROM lumi.files WHERE user_id=$1 AND kind='generated' AND deleted_at IS NULL", owner).Scan(&count); err != nil {
		return err
	}
	for i := count; i < 1000; i++ {
		id, err := uuid.NewV7()
		if err != nil {
			return err
		}
		path, thumbPath := "m7-fixture/"+id.String()+".png", "m7-fixture/"+id.String()+".webp"
		for name, contents := range map[string][]byte{path: raw, thumbPath: thumb} {
			file, err := root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			if err != nil {
				return err
			}
			_, writeErr := file.Write(contents)
			if err := errors.Join(writeErr, file.Close()); err != nil {
				return err
			}
		}
		if _, err := transaction.Exec(ctx, `INSERT INTO lumi.files
			(id,user_id,kind,task_id,path,thumbnail_path,mime,size,width,height,thumbnail_width,thumbnail_height,sha256,created_at)
			SELECT $1,user_id,kind,task_id,$2,$3,mime,size,width,height,thumbnail_width,thumbnail_height,sha256,now()-$4*interval '1 second'
			FROM lumi.files WHERE id=$5`, id, path, thumbPath, i, template); err != nil {
			return fmt.Errorf("copy gallery fixture: %w", err)
		}
	}
	return transaction.Commit(ctx)
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if err := seed(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "gallery fixture failed")
		os.Exit(1)
	}
	fmt.Println("gallery fixture ready: 1000 real file rows and byte pairs")
}
