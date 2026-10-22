//go:build integration

// Command chatseed creates owner-scoped, synthetic performance fixtures in an explicit test database.
package main

import (
	"context"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"net/url"
	"os"
	"strings"
	"time"
)

func seed(ctx context.Context) error {
	source := os.Getenv("E2E_DATABASE_URL")
	parsed, err := url.Parse(source)
	if err != nil || os.Getenv("APP_ENV") != "test" || parsed == nil || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") {
		return fmt.Errorf("an explicit loopback test database is required")
	}
	owner, err := uuid.Parse(os.Getenv("E2E_CHAT_USER_ID"))
	if err != nil {
		return fmt.Errorf("test user ID required")
	}
	conversation, err := uuid.Parse(os.Getenv("E2E_CHAT_CONVERSATION_ID"))
	if err != nil {
		return fmt.Errorf("test conversation ID required")
	}
	prefix := os.Getenv("E2E_CHAT_PREFIX")
	if prefix == "" || len(prefix) > 40 {
		return fmt.Errorf("test prefix required")
	}
	connection, err := pgx.Connect(ctx, source)
	if err != nil {
		return fmt.Errorf("connect test fixture: %w", err)
	}
	defer func() {
		if err := connection.Close(ctx); err != nil {
			fmt.Fprintln(os.Stderr, "test fixture connection close failed")
		}
	}()
	var email string
	if err := connection.QueryRow(ctx, "SELECT email FROM lumi.users WHERE id=$1 AND deleted_at IS NULL", owner).Scan(&email); err != nil || !strings.HasSuffix(email, "@lumi.test") {
		return fmt.Errorf("fixture requires an existing test account")
	}
	transaction, err := connection.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin test fixture: %w", err)
	}
	defer func() {
		if err := transaction.Rollback(ctx); err != nil && err != pgx.ErrTxClosed {
			fmt.Fprintln(os.Stderr, "test fixture rollback failed")
		}
	}()
	base := time.Now().UTC()
	for i := 0; i < 140; i++ {
		id, err := uuid.NewV7()
		if err != nil {
			return err
		}
		if _, err := transaction.Exec(ctx, "INSERT INTO lumi.conversations(id,user_id,title,last_message_at,title_auto) VALUES($1,$2,$3,$4,false)", id, owner, fmt.Sprintf("%s-history-%03d", prefix, i), base.Add(-time.Duration(i+1)*time.Minute)); err != nil {
			return fmt.Errorf("insert history fixture: %w", err)
		}
	}
	if _, err := transaction.Exec(ctx, "INSERT INTO lumi.conversations(id,user_id,title,last_message_at,title_auto) VALUES($1,$2,$3,$4,false)", conversation, owner, prefix+"-performance", base); err != nil {
		return fmt.Errorf("insert conversation fixture: %w", err)
	}
	for i := 0; i < 260; i++ {
		id, err := uuid.NewV7()
		if err != nil {
			return err
		}
		role := "user"
		if i%2 == 1 {
			role = "assistant"
		}
		if _, err := transaction.Exec(ctx, "INSERT INTO lumi.messages(id,conversation_id,request_id,role,content,status,created_at) VALUES($1,$2,$3,$4,$5,'completed',$6)", id, conversation, id, role, fmt.Sprintf("Message %03d. %s", i, strings.Repeat("A deliberate conversation about light, wind and ideas. ", 6)), base.Add(time.Duration(i)*time.Millisecond)); err != nil {
			return fmt.Errorf("insert message fixture: %w", err)
		}
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit test fixture: %w", err)
	}
	return nil
}
func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := seed(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "synthetic chat fixture failed")
		os.Exit(1)
	}
	fmt.Println("synthetic chat fixture ready")
}
