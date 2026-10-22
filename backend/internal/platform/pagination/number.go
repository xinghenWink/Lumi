package pagination

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
)

type numberCursor struct {
	Number *int64    `json:"number"`
	ID     uuid.UUID `json:"id"`
	Filter string    `json:"filter"`
}

func DecodeNumber(value, filter string) (*int64, uuid.UUID, error) {
	if value == "" {
		return nil, uuid.Nil, nil
	}
	if len(value) > 2048 {
		return nil, uuid.Nil, problem.Invalid()
	}
	encoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, uuid.Nil, problem.Invalid()
	}
	var cursor numberCursor
	if err := json.Unmarshal(encoded, &cursor); err != nil || cursor.Number == nil || *cursor.Number < 0 || *cursor.Number > 2_000_000_000_000 || cursor.ID == uuid.Nil || cursor.Filter != filter {
		return nil, uuid.Nil, problem.Invalid()
	}
	return cursor.Number, cursor.ID, nil
}
func EncodeNumber(value int64, id uuid.UUID, filter string) (string, error) {
	encoded, err := json.Marshal(numberCursor{Number: &value, ID: id, Filter: filter})
	if err != nil {
		return "", fmt.Errorf("encode numeric cursor: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(encoded), nil
}
