package web

import (
	"bytes"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/xinghenWink/Lumi/backend/internal/http/response"
)

func Handler(content fs.FS) gin.HandlerFunc {
	return func(c *gin.Context) {
		requestPath := c.Request.URL.Path
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead || isAPI(requestPath) {
			response.WriteError(c, http.StatusNotFound, "NOT_FOUND", "The requested resource was not found.")
			return
		}
		filename := strings.TrimPrefix(path.Clean(requestPath), "/")
		if filename == "" || filename == "." {
			filename = "index.html"
		}
		data, err := fs.ReadFile(content, filename)
		if err != nil {
			// Missing static assets must not receive an HTML SPA fallback.
			if filename != "index.html" && (path.Ext(filename) != "" || strings.HasPrefix(filename, "assets/")) {
				response.WriteError(c, http.StatusNotFound, "NOT_FOUND", "The requested resource was not found.")
				return
			}
			filename = "index.html"
			data, err = fs.ReadFile(content, filename)
		}
		if err != nil {
			response.WriteError(c, http.StatusServiceUnavailable, "WEB_BUILD_REQUIRED", "Build the frontend before starting the server.")
			return
		}
		if strings.HasPrefix(filename, "assets/") {
			c.Header("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			c.Header("Cache-Control", "no-cache")
		}
		if contentType := mime.TypeByExtension(path.Ext(filename)); contentType != "" {
			c.Header("Content-Type", contentType)
		}
		http.ServeContent(c.Writer, c.Request, filename, time.Time{}, bytes.NewReader(data))
	}
}

func isAPI(value string) bool {
	return value == "/api" || strings.HasPrefix(value, "/api/") || value == "/healthz" || value == "/readyz"
}
