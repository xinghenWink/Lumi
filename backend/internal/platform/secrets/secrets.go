package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
)

type Vault struct{ aead cipher.AEAD }

func New(key []byte) (*Vault, error) {
	if len(key) != 32 {
		return nil, fmt.Errorf("encryption key must contain 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create encryption cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create authenticated encryption: %w", err)
	}
	return &Vault{aead: aead}, nil
}

func (v *Vault) Encrypt(value, purpose string) (string, error) {
	if value == "" {
		return "", nil
	}
	nonce := make([]byte, v.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("generate encryption nonce: %w", err)
	}
	sealed := v.aead.Seal(nonce, nonce, []byte(value), []byte(purpose))
	return base64.StdEncoding.EncodeToString(sealed), nil
}

func (v *Vault) Decrypt(encoded, purpose string) (string, error) {
	if encoded == "" {
		return "", nil
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(data) < v.aead.NonceSize()+v.aead.Overhead() {
		return "", fmt.Errorf("invalid encrypted secret")
	}
	value, err := v.aead.Open(nil, data[:v.aead.NonceSize()], data[v.aead.NonceSize():], []byte(purpose))
	if err != nil {
		return "", fmt.Errorf("decrypt secret: %w", err)
	}
	return string(value), nil
}
