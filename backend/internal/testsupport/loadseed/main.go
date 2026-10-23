//go:build integration

// Command loadseed creates 100 distinct authenticated test actors, outside measured traffic.
package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/netip"
	"net/url"
	"os"
	"time"
	_ "time/tzdata" // The optional standalone fixture binary also needs IANA zones.

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/auth"
	"github.com/xinghenWink/Lumi/backend/internal/credits"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/password"
)

type actor struct {
	Token string `json:"token"`
}

func seed(ctx context.Context) error {
	source := os.Getenv("E2E_DATABASE_URL")
	parsed, err := url.Parse(source)
	if err != nil || os.Getenv("APP_ENV") != "test" || parsed == nil || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") {
		return fmt.Errorf("explicit loopback test database required")
	}
	pool, err := db.Open(ctx, source)
	if err != nil {
		return err
	}
	defer pool.Close()
	tokens, err := auth.NewTokens([]byte(os.Getenv("JWT_SECRET")))
	if err != nil {
		return err
	}
	hasher, err := password.New(ctx)
	if err != nil {
		return err
	}
	hash, err := hasher.Hash(ctx, rand.Text()+"Aa1")
	if err != nil {
		return err
	}
	billing := credits.New(pool, nil, nil, nil)
	actors := make([]actor, 0, 100)
	err = db.Transaction(ctx, pool, func(q *query.Queries) error {
		for i := 0; i < 100; i++ {
			id, family, session := uuid.New(), uuid.New(), uuid.New()
			now := time.Now().UTC()
			record, err := q.CreateUser(ctx, query.CreateUserParams{ID: id, Email: "load-" + id.String() + "@lumi.test", PasswordHash: hash, Nickname: "Load fixture", Role: "user", Status: "active", TermsAcceptedAt: &now})
			if err != nil {
				return err
			}
			if err := billing.Signup(ctx, q, id); err != nil {
				return err
			}
			if _, err := q.CreateSession(ctx, query.CreateSessionParams{ID: session, UserID: id, FamilyID: family, TokenHash: auth.RefreshHash(rand.Text()), Device: "k6", Ip: netip.MustParseAddr("127.0.0.1"), UserAgent: "k6", ExpiresAt: now.Add(time.Hour)}); err != nil {
				return err
			}
			token, err := tokens.Issue(record, family)
			if err != nil {
				return err
			}
			actors = append(actors, actor{Token: token})
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("seed load actors: %w", err)
	}
	encoded, err := json.Marshal(actors)
	if err != nil {
		return err
	}
	// Tokens are private artifacts and never written to stdout or committed.
	if err := os.WriteFile("../.tools/m7-load/actors.json", encoded, 0600); err != nil {
		return fmt.Errorf("write private actors: %w", err)
	}
	return nil
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if err := seed(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "load fixture failed")
		os.Exit(1)
	}
	fmt.Println("100 isolated load actors ready")
}
