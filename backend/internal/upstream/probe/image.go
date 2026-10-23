package probe

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

func readReference(path string) (result []byte, resultErr error) {
	file, err := os.Open(path) // #nosec G304 -- An explicit CLI reference-file argument selects this local input.
	if err != nil {
		return nil, fmt.Errorf("open probe reference: %w", err)
	}
	defer func() {
		if err := file.Close(); err != nil && resultErr == nil {
			resultErr = fmt.Errorf("close probe reference: %w", err)
		}
	}()
	result, err = io.ReadAll(io.LimitReader(file, (10<<20)+1))
	if err != nil {
		return nil, fmt.Errorf("read probe reference: %w", err)
	}
	if len(result) > 10<<20 || http.DetectContentType(result) != "image/png" {
		return nil, fmt.Errorf("probe reference must be a PNG no larger than 10 MiB")
	}
	return result, nil
}

// Image bytes are an explicit private artifact, never embedded in the JSON report.
func saveImage(prefix string, value json.RawMessage) (string, string) {
	var encoded string
	if json.Unmarshal(value, &encoded) != nil {
		return "", "IMAGE_OUTPUT_UNAVAILABLE"
	}
	raw, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || len(raw) > 20<<20 {
		return "", "IMAGE_OUTPUT_INVALID"
	}
	extension := ""
	switch http.DetectContentType(raw) {
	case "image/png":
		extension = ".png"
	case "image/jpeg":
		extension = ".jpg"
	case "image/webp":
		extension = ".webp"
	}
	if extension == "" {
		return "", "IMAGE_OUTPUT_INVALID"
	}
	path := prefix + extension
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		return "", "IMAGE_OUTPUT_WRITE_FAILED"
	}
	return path, ""
}
