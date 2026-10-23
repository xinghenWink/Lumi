package probe

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
)

func dataURL(image []byte) string {
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(image)
}

func visionRequest(model string, image []byte) ([]byte, error) {
	payload, err := json.Marshal(map[string]any{
		"model": model, "stream": true,
		"messages": []map[string]any{{"role": "user", "content": []map[string]any{
			{"type": "text", "text": "Name the color of the square in this image."},
			{"type": "image_url", "image_url": map[string]string{"url": dataURL(image)}},
		}}},
	})
	if err != nil {
		return nil, fmt.Errorf("encode vision probe: %w", err)
	}
	return payload, nil
}
