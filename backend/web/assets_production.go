//go:build production

package web

import (
	"embed"
	"fmt"
	"io/fs"
)

//go:embed all:dist
var assets embed.FS

func Assets() (fs.FS, error) {
	content, err := fs.Sub(assets, "dist")
	if err != nil {
		return nil, fmt.Errorf("open embedded frontend: %w", err)
	}
	return content, nil
}
