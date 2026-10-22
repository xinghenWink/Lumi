package pagination

import (
	"github.com/google/uuid"
	"testing"
)

func TestNumberCursorBindings(t *testing.T) {
	id := uuid.New()
	encoded, err := EncodeNumber(0, id, "filter")
	if err != nil {
		t.Fatal(err)
	}
	value, decoded, err := DecodeNumber(encoded, "filter")
	if err != nil || value == nil || *value != 0 || decoded != id {
		t.Fatal("zero balance cursor failed")
	}
	if _, _, err := DecodeNumber(encoded, "another-filter"); err == nil {
		t.Fatal("accepted changed filters")
	}
	if _, err := Decode(encoded, "filter"); err == nil {
		t.Fatal("accepted numeric cursor in time pagination")
	}
}
