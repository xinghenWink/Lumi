package auth

import (
	"crypto/rand"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
)

func TestAccessTokenValidation(t *testing.T) {
	key := []byte(rand.Text() + rand.Text())
	tokens, err := NewTokens(key)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 22, 0, 0, 0, 0, time.UTC)
	tokens.now = func() time.Time { return now }
	id, family := uuid.New(), uuid.New()
	encoded, err := tokens.Issue(query.User{ID: id, TokenVersion: 3}, family)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := tokens.Parse(encoded)
	if err != nil || claims.Subject != id.String() || claims.FamilyID != family.String() || claims.Version != 3 {
		t.Fatalf("parse token: %+v %v", claims, err)
	}
	tokens.now = func() time.Time { return now.Add(16 * time.Minute) }
	if _, err := tokens.Parse(encoded); err == nil {
		t.Fatal("accepted expired token")
	}
	tokens.now = func() time.Time { return now }
	for _, test := range []struct {
		name, issuer, audience string
		expiry                 bool
		method                 jwt.SigningMethod
	}{{"wrong issuer", "other", "lumi-web", true, jwt.SigningMethodHS256}, {"wrong audience", "lumi", "other", true, jwt.SigningMethodHS256}, {"no expiry", "lumi", "lumi-web", false, jwt.SigningMethodHS256}, {"wrong algorithm", "lumi", "lumi-web", true, jwt.SigningMethodHS384}} {
		t.Run(test.name, func(t *testing.T) {
			claims.Issuer = test.issuer
			claims.Audience = jwt.ClaimStrings{test.audience}
			if test.expiry {
				claims.ExpiresAt = jwt.NewNumericDate(now.Add(time.Minute))
			} else {
				claims.ExpiresAt = nil
			}
			value, err := jwt.NewWithClaims(test.method, claims).SignedString(key)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := tokens.Parse(value); err == nil {
				t.Fatal("accepted invalid token")
			}
		})
	}
	other, err := NewTokens([]byte(rand.Text() + rand.Text()))
	if err != nil {
		t.Fatal(err)
	}
	other.now = tokens.now
	if _, err := other.Parse(encoded); err == nil {
		t.Fatal("accepted wrong signing key")
	}
	if _, err := NewTokens([]byte("short")); err == nil {
		t.Fatal("accepted short signing key")
	}
}

func TestRefreshTokens(t *testing.T) {
	first, err := NewRefreshToken()
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewRefreshToken()
	if err != nil {
		t.Fatal(err)
	}
	if first == second || len(first) != 43 || RefreshHash(first) == first || len(RefreshHash(first)) != 64 {
		t.Fatal("invalid opaque refresh token")
	}
}
