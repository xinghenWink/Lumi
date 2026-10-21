package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
)

type Claims struct {
	FamilyID string `json:"sid"`
	Version  int64  `json:"ver"`
	jwt.RegisteredClaims
}
type Tokens struct {
	key []byte
	now func() time.Time
}

func NewTokens(secret []byte) (*Tokens, error) {
	if len(secret) < 32 {
		return nil, fmt.Errorf("JWT_SECRET must contain at least 32 bytes")
	}
	return &Tokens{key: append([]byte(nil), secret...), now: time.Now}, nil
}

func (t *Tokens) Issue(record query.User, family uuid.UUID) (string, error) {
	now := t.now().UTC()
	claims := Claims{FamilyID: family.String(), Version: record.TokenVersion, RegisteredClaims: jwt.RegisteredClaims{
		Issuer: "lumi", Subject: record.ID.String(), Audience: jwt.ClaimStrings{"lumi-web"}, ExpiresAt: jwt.NewNumericDate(now.Add(15 * time.Minute)), IssuedAt: jwt.NewNumericDate(now), NotBefore: jwt.NewNumericDate(now), ID: rand.Text(),
	}}
	encoded, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(t.key)
	if err != nil {
		return "", fmt.Errorf("sign access token: %w", err)
	}
	return encoded, nil
}

func (t *Tokens) Parse(encoded string) (Claims, error) {
	if len(encoded) == 0 || len(encoded) > 4096 {
		return Claims{}, problem.Unauthorized()
	}
	claims := Claims{}
	parsed, err := jwt.ParseWithClaims(encoded, &claims, func(*jwt.Token) (any, error) { return t.key, nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("lumi"), jwt.WithAudience("lumi-web"), jwt.WithExpirationRequired(), jwt.WithIssuedAt(), jwt.WithLeeway(5*time.Second), jwt.WithTimeFunc(t.now))
	if err != nil || !parsed.Valid || claims.Version < 0 {
		return Claims{}, problem.Unauthorized()
	}
	if id, err := uuid.Parse(claims.Subject); err != nil || id == uuid.Nil {
		return Claims{}, problem.Unauthorized()
	}
	if id, err := uuid.Parse(claims.FamilyID); err != nil || id == uuid.Nil {
		return Claims{}, problem.Unauthorized()
	}
	return claims, nil
}

func (t *Tokens) CodeHash(email, code string) ([]byte, error) {
	mac := hmac.New(sha256.New, t.key)
	if _, err := mac.Write([]byte("register\x00" + email + "\x00" + code)); err != nil {
		return nil, fmt.Errorf("hash verification code: %w", err)
	}
	return mac.Sum(nil), nil
}

func NewRefreshToken() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("generate refresh token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}
func RefreshHash(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}
