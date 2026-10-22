package password

import (
	"context"
	"strings"
	"testing"
)

func TestPasswordHashing(t *testing.T) {
	hasher, err := New(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	value := "TestOnlyPassword42"
	first, err := hasher.Hash(t.Context(), value)
	if err != nil {
		t.Fatal(err)
	}
	second, err := hasher.Hash(t.Context(), value)
	if err != nil {
		t.Fatal(err)
	}
	if first == second || strings.Contains(first, value) || !strings.HasPrefix(first, "$argon2id$") {
		t.Fatal("password was not salted and hashed")
	}
	for _, test := range []struct {
		value string
		want  bool
	}{{value, true}, {"WrongPassword42", false}} {
		valid, err := hasher.Verify(t.Context(), first, test.value)
		if err != nil || valid != test.want {
			t.Errorf("Verify: valid=%v err=%v", valid, err)
		}
	}
	if _, err := hasher.Verify(t.Context(), "$argon2id$v=19$m=999999999,t=2,p=1$bad$bad", value); err == nil {
		t.Fatal("accepted unbounded memory parameters")
	}
	canceled, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := hasher.Hash(canceled, value); err == nil {
		t.Fatal("hash ignored canceled context")
	}
}

func TestPasswordPolicy(t *testing.T) {
	for _, test := range []struct {
		value string
		valid bool
	}{{"short1", false}, {"abcdefgh", false}, {"12345678", false}, {"strongpass9", true}, {strings.Repeat("a", 129) + "1", false}} {
		if (Validate(test.value) == nil) != test.valid {
			t.Errorf("unexpected validation for length %d", len(test.value))
		}
	}
}
