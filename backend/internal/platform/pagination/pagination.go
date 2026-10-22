package pagination

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
)

type Cursor struct {
	Time   *time.Time `json:"time"`
	ID     uuid.UUID  `json:"id"`
	Filter string     `json:"filter"`
}

func Fingerprint(values ...string) string {
	encoded, err := json.Marshal(values)
	if err != nil {
		return ""
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}

func Decode(value, filter string) (Cursor, error) {
	if value == "" {
		return Cursor{Filter: filter}, nil
	}
	if len(value) > 2048 {
		return Cursor{}, problem.Invalid()
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return Cursor{}, problem.Invalid()
	}
	var cursor Cursor
	if err := json.Unmarshal(decoded, &cursor); err != nil || cursor.Time == nil || cursor.ID == uuid.Nil || cursor.Filter != filter {
		return Cursor{}, problem.Invalid()
	}
	return cursor, nil
}

func Encode(at time.Time, id uuid.UUID, filter string) (string, error) {
	at = at.UTC()
	encoded, err := json.Marshal(Cursor{Time: &at, ID: id, Filter: filter})
	if err != nil {
		return "", fmt.Errorf("encode pagination cursor: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(encoded), nil
}
