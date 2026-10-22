package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/xinghenWink/Lumi/backend/internal/http/response"
)

type Check func(context.Context) error

type Health struct {
	Postgres Check
	Redis    Check
}

func (h Health) Live(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (h Health) Ready(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	for _, check := range []Check{h.Postgres, h.Redis} {
		if check == nil || check(ctx) != nil {
			response.WriteError(c, http.StatusServiceUnavailable, "DEPENDENCY_UNAVAILABLE", "Service dependencies are unavailable.")
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"status": "ok", "checks": gin.H{"postgres": "ok", "redis": "ok"},
	})
}
