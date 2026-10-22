package router

import (
	"fmt"
	"io/fs"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/xinghenWink/Lumi/backend/internal/http/handler"
	"github.com/xinghenWink/Lumi/backend/internal/http/middleware"
	"github.com/xinghenWink/Lumi/backend/web"
)

func New(logger *slog.Logger, health handler.Health, version handler.Version, content fs.FS) (*gin.Engine, error) {
	engine := gin.New()
	if err := engine.SetTrustedProxies(nil); err != nil {
		return nil, fmt.Errorf("configure trusted proxies: %w", err)
	}
	engine.Use(middleware.RequestContext(), middleware.SecurityHeaders(), middleware.AccessLog(logger), middleware.Recovery(logger))
	engine.GET("/healthz", health.Live)
	engine.GET("/readyz", health.Ready)
	engine.GET("/api/version", version.Get)
	engine.NoRoute(web.Handler(content))
	return engine, nil
}
