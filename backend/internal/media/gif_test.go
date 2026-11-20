package media

import (
	"bytes"
	"image"
	"image/color"
	"image/gif"
	"image/png"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func fixtureGIF(t *testing.T, frameCount int) []byte {
	t.Helper()
	palette := color.Palette{color.Black, color.RGBA{R: 255, A: 255}, color.RGBA{G: 255, A: 255}}
	animation := gif.GIF{Config: image.Config{ColorModel: palette, Width: 4, Height: 3}}
	for index := range frameCount {
		frame := image.NewPaletted(image.Rect(1, 1, 3, 2), palette)
		frame.SetColorIndex(1, 1, 1+uint8(index%2))
		animation.Image = append(animation.Image, frame)
		animation.Delay = append(animation.Delay, 20+index%2)
	}
	var output bytes.Buffer
	if err := gif.EncodeAll(&output, &animation); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func TestGeneratedGIFPreservesAnimationAndUsesFirstFrame(t *testing.T) {
	store := testStore(t)
	raw := fixtureGIF(t, 2)
	file, err := store.PrepareImageResult(t.Context(), uuid.New(), uuid.New(), raw, "gif", nil)
	if err != nil {
		t.Fatal(err)
	}
	if file.Mime != "image/gif" || !strings.HasSuffix(file.Path, ".gif") || file.Width != 4 || file.Height != 3 || file.Size != int64(len(raw)) {
		t.Fatalf("wrong GIF metadata: %+v", file)
	}
	stored, err := store.root.ReadFile(file.Path)
	if err != nil || !bytes.Equal(stored, raw) {
		t.Fatalf("animation was modified: %v", err)
	}
	thumb, err := store.root.ReadFile(file.ThumbnailPath)
	if err != nil {
		t.Fatal(err)
	}
	poster, format, err := image.Decode(bytes.NewReader(thumb))
	if err != nil || format != "webp" || poster.Bounds() != image.Rect(0, 0, 4, 3) {
		t.Fatalf("invalid GIF thumbnail: format=%q err=%v", format, err)
	}
	assertPoster := func(poster image.Image) {
		t.Helper()
		if r, g, _, a := poster.At(1, 1).RGBA(); r != 0xffff || g != 0 || a != 0xffff {
			t.Fatalf("poster did not use the first frame: rgba=(%d,%d,...,%d)", r, g, a)
		}
	}
	assertPoster(poster)
	ref, err := store.gifReference(t.Context(), stored)
	if err != nil {
		t.Fatal(err)
	}
	poster, err = png.Decode(bytes.NewReader(ref))
	if err != nil || poster.Bounds() != image.Rect(0, 0, 4, 3) {
		t.Fatalf("invalid PNG reference: %v", err)
	}
	assertPoster(poster)
}

func TestRejectsInvalidGIFBeforeSaving(t *testing.T) {
	store := testStore(t)
	raw := fixtureGIF(t, 2)
	for _, tc := range []struct {
		name, format string
		data         []byte
	}{
		{name: "missing trailer", format: "gif", data: raw[:len(raw)-1]},
		{name: "too many frames", format: "gif", data: fixtureGIF(t, 513)},
		{name: "wrong requested type", format: "gif", data: fixturePNG(t)},
		{name: "explicit PNG", format: "png", data: raw},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := store.PrepareImageResult(t.Context(), uuid.New(), uuid.New(), tc.data, tc.format, nil); err == nil {
				t.Fatal("unexpected GIF result accepted")
			}
		})
	}
	if _, err := store.Prepare(t.Context(), uuid.New(), nil, "upload", raw, 10<<20); err == nil {
		t.Fatal("GIF upload accepted")
	}
}
