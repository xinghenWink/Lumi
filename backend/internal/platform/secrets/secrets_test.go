package secrets

import (
	"crypto/rand"
	"testing"
)

func TestAuthenticatedEncryption(t *testing.T) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	vault, err := New(key)
	if err != nil {
		t.Fatal(err)
	}
	value := rand.Text()
	first, err := vault.Encrypt(value, "mail")
	if err != nil {
		t.Fatal(err)
	}
	second, err := vault.Encrypt(value, "mail")
	if err != nil {
		t.Fatal(err)
	}
	if first == second || first == value {
		t.Fatal("encryption nonce was reused")
	}
	decoded, err := vault.Decrypt(first, "mail")
	if err != nil || decoded != value {
		t.Fatalf("roundtrip: %v", err)
	}
	if _, err := vault.Decrypt(first, "different-purpose"); err == nil {
		t.Fatal("accepted wrong associated data")
	}
	if _, err := vault.Decrypt("invalid", "mail"); err == nil {
		t.Fatal("accepted invalid ciphertext")
	}
	if _, err := New(key[:16]); err == nil {
		t.Fatal("accepted short encryption key")
	}
}
