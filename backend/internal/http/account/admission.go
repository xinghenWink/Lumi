package account

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// Bound short read work before authentication so a dashboard refresh burst cannot
// fill the shared database pool ahead of interactive chat and cancellation.
// Streaming responses and file transfers must never hold a read admission slot.
func admitReads(limit int) gin.HandlerFunc {
	slots := make(chan struct{}, limit)
	return func(c *gin.Context) {
		path := c.FullPath()
		if c.Request.Method != http.MethodGet || strings.HasSuffix(path, "/events") ||
			strings.HasPrefix(path, "/api/v1/files/") || strings.HasSuffix(path, "/export") {
			c.Next()
			return
		}
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
			c.Next()
		case <-c.Request.Context().Done():
			c.Abort()
		}
	}
}
