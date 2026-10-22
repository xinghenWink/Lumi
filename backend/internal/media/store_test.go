package media

import (
	"bytes"
	"context"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
)

func fixturePNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 1200, 600))
	for y := 0; y < 600; y++ {
		for x := 0; x < 1200; x++ {
			img.SetNRGBA(x, y, color.NRGBA{R: 80, G: 90, B: 200, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
func testStore(t *testing.T) *Store {
	t.Helper()
	store, err := New(nil, t.TempDir(), bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Error(err)
		}
	})
	return store
}
func TestNormalizationThumbnailAndMetadataRemoval(t *testing.T) {
	store := testStore(t)
	raw := fixturePNG(t)
	// Insert a valid ancillary metadata chunk that must not survive re-encoding.
	var chunk bytes.Buffer
	if err := binary.Write(&chunk, binary.BigEndian, uint32(13)); err != nil {
		t.Fatal(err)
	}
	chunk.WriteString("eXIf")
	chunk.WriteString("test-metadata")
	checksum := crc32.ChecksumIEEE(chunk.Bytes()[4:])
	if err := binary.Write(&chunk, binary.BigEndian, checksum); err != nil {
		t.Fatal(err)
	}
	raw = append(append(append([]byte{}, raw[:33]...), chunk.Bytes()...), raw[33:]...)
	prepared, err := store.Prepare(t.Context(), uuid.New(), nil, "upload", raw, 10<<20)
	if err != nil {
		t.Fatal(err)
	}
	normalized, err := store.root.ReadFile(prepared.Path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(normalized, []byte("test-metadata")) {
		t.Fatal("upload metadata survived normalization")
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(normalized))
	if err != nil || format != "png" || cfg.Width != 1200 || cfg.Height != 600 {
		t.Fatalf("normalized image invalid: %v", err)
	}
	thumb, err := store.root.ReadFile(prepared.ThumbnailPath)
	if err != nil {
		t.Fatal(err)
	}
	cfg, format, err = image.DecodeConfig(bytes.NewReader(thumb))
	if err != nil || format != "webp" || cfg.Width != 512 || cfg.Height != 256 {
		t.Fatalf("thumbnail invalid: %+v %s %v", cfg, format, err)
	}
}
func TestRejectsImageBombAndNonImage(t *testing.T) {
	store := testStore(t)
	for _, raw := range [][]byte{[]byte("<svg xmlns='http://www.w3.org/2000/svg'/>"), []byte("not an image")} {
		if _, err := store.Prepare(t.Context(), uuid.New(), nil, "upload", raw, 10<<20); err == nil {
			t.Fatal("non-image upload accepted")
		}
	}
	raw := fixturePNG(t)
	binary.BigEndian.PutUint32(raw[16:20], 8192)
	binary.BigEndian.PutUint32(raw[20:24], 8192)
	binary.BigEndian.PutUint32(raw[29:33], crc32.ChecksumIEEE(raw[12:29]))
	if _, err := store.Prepare(t.Context(), uuid.New(), nil, "upload", raw, 10<<20); err == nil {
		t.Fatal("pixel bomb accepted")
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := store.Prepare(ctx, uuid.New(), nil, "upload", fixturePNG(t), 10<<20); err == nil {
		t.Fatal("canceled image decode started")
	}
}
func TestSignedAccessIsBoundToViewerVariantAndExpiry(t *testing.T) {
	store := testStore(t)
	id, owner := uuid.New(), uuid.New()
	expires := time.Now().Unix() + 300
	sig := store.signed(id, owner, "thumb", expires)
	if !store.Verify(id, owner, true, expires, sig) {
		t.Fatal("valid signature rejected")
	}
	for _, valid := range []bool{
		store.Verify(id, uuid.New(), true, expires, sig), store.Verify(id, owner, false, expires, sig),
		store.Verify(uuid.New(), owner, true, expires, sig), store.Verify(id, owner, true, expires+1, sig),
		store.Verify(id, owner, true, time.Now().Unix()-1, store.signed(id, owner, "thumb", time.Now().Unix()-1)),
	} {
		if valid {
			t.Fatal("signature scope escaped")
		}
	}
}
func TestRootRejectsMetadataPathEscape(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "outside.png"), []byte("private"), 0600); err != nil {
		t.Fatal(err)
	}
	store, err := New(nil, directory, bytes.Repeat([]byte{9}, 32))
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := store.Close(); err != nil {
			t.Error(err)
		}
	}()
	file, _, err := store.Open(t.Context(), query.File{Path: "../outside.png", Mime: "image/png"}, false)
	if err == nil {
		if err := file.Close(); err != nil {
			t.Error(err)
		}
		t.Fatal("metadata path escaped image root")
	}
}
