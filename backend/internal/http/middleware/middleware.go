package middleware

import (
	"context"
	"crypto/rand"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/xinghenWink/Lumi/backend/internal/http/response"
)

type requestIDKey struct{}

func RequestID(ctx context.Context) string {
	id, ok := ctx.Value(requestIDKey{}).(string)
	if !ok {
		return ""
	}
	return id
}

func RequestContext() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Generate IDs server-side rather than reflecting untrusted headers.
		id := rand.Text()
		c.Set("request_id", id)
		c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), requestIDKey{}, id))
		c.Header("X-Request-ID", id)
		c.Next()
	}
}

func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		// Math and syntax engines generate style attributes; script and style elements stay restricted.
		c.Header("Content-Security-Policy", "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; script-src-attr 'none'; style-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
		c.Header("X-Frame-Options", "DENY")
		c.Next()
	}
}

func AccessLog(logger *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		started := time.Now()
		c.Next()
		// Log route patterns only; URLs, query strings and bodies can contain secrets.
		logger.InfoContext(c.Request.Context(), "http request",
			"request_id", RequestID(c.Request.Context()), "method", c.Request.Method,
			"route", c.FullPath(), "status", c.Writer.Status(), "duration_ms", time.Since(started).Milliseconds())
	}
}

func Recovery(logger *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if recovered := recover(); recovered != nil {
				// Panic payloads may contain credentials or user content.
				logger.ErrorContext(c.Request.Context(), "request panic", "request_id", RequestID(c.Request.Context()))
				response.WriteError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred.")
			}
		}()
		c.Next()
	}
}
