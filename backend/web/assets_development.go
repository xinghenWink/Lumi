//go:build !production

package web

import (
	"io/fs"
	"os"
)

// Development reads the Vite output without rebuilding the Go binary.
func Assets() (fs.FS, error) {
	return os.DirFS("web/dist"), nil
}
