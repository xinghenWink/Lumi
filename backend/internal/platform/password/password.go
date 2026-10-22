package password

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"golang.org/x/crypto/argon2"
)

const parameters = "$argon2id$v=19$m=19456,t=2,p=1$"

type Hasher struct {
	slots chan struct{}
	dummy string
}

func New(ctx context.Context) (*Hasher, error) {
	h := &Hasher{slots: make(chan struct{}, 4)}
	encoded, err := h.Hash(ctx, rand.Text()+"a1")
	if err != nil {
		return nil, fmt.Errorf("create dummy password hash: %w", err)
	}
	h.dummy = encoded
	return h, nil
}

func Validate(value string) error {
	letters, digits := false, false
	for _, character := range value {
		letters = letters || unicode.IsLetter(character)
		digits = digits || unicode.IsDigit(character)
	}
	if !utf8.ValidString(value) || utf8.RuneCountInString(value) < 8 || utf8.RuneCountInString(value) > 128 || !letters || !digits {
		return problem.New("PASSWORD_WEAK", http.StatusBadRequest)
	}
	return nil
}

func (h *Hasher) Hash(ctx context.Context, value string) (string, error) {
	if err := h.acquire(ctx); err != nil {
		return "", err
	}
	defer func() { <-h.slots }()
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate password salt: %w", err)
	}
	key := argon2.IDKey([]byte(value), salt, 2, 19456, 1, 32)
	if err := ctx.Err(); err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	return parameters + base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(key), nil
}

func (h *Hasher) Verify(ctx context.Context, encoded, value string) (bool, error) {
	// Fixed, bounded parameters prevent a corrupt PHC string from exhausting memory.
	if !strings.HasPrefix(encoded, parameters) {
		return false, fmt.Errorf("unsupported password hash")
	}
	parts := strings.Split(strings.TrimPrefix(encoded, parameters), "$")
	if len(parts) != 2 {
		return false, fmt.Errorf("invalid password hash")
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[0])
	if err != nil || len(salt) != 16 {
		return false, fmt.Errorf("invalid password salt")
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[1])
	if err != nil || len(expected) != 32 {
		return false, fmt.Errorf("invalid password digest")
	}
	if err := h.acquire(ctx); err != nil {
		return false, err
	}
	defer func() { <-h.slots }()
	actual := argon2.IDKey([]byte(value), salt, 2, 19456, 1, 32)
	if err := ctx.Err(); err != nil {
		return false, fmt.Errorf("verify password: %w", err)
	}
	return subtle.ConstantTimeCompare(actual, expected) == 1, nil
}

func (h *Hasher) Dummy(ctx context.Context, value string) error {
	if _, err := h.Verify(ctx, h.dummy, value); err != nil {
		return fmt.Errorf("verify dummy hash: %w", err)
	}
	return nil
}

func (h *Hasher) acquire(ctx context.Context) error {
	select {
	case h.slots <- struct{}{}:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("wait for password worker: %w", ctx.Err())
	}
}
