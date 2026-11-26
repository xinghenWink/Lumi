package account

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/xinghenWink/Lumi/backend/internal/credits"
)

func (h *Handler) videoConfigRoutes(protected, admin *gin.RouterGroup) {
	admin.GET("/video-protocols", func(c *gin.Context) { c.JSON(200, gin.H{"items": h.services.Catalog.VideoBindings()}) })
	admin.GET("/video-credit-pool", h.videoPool)
	admin.PUT("/video-credit-pool", h.csrf, h.adminLimit, h.videoPool)
	admin.GET("/video-pricing/:model", h.videoPricing)
	admin.PUT("/video-pricing/:model", h.csrf, h.adminLimit, h.videoPricing)
	protected.GET("/video-credit-pool", h.videoPool)
}

func (h *Handler) videoPool(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	if c.Request.Method == http.MethodGet {
		result, err := h.services.Credits.VideoPool(ctx)
		h.imageReply(c, result, err, 200)
		return
	}
	var input credits.VideoPool
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Credits.SaveVideoPool(ctx, p.Actor, input)
	h.imageReply(c, result, err, 200)
}

func (h *Handler) videoPricing(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("model"))
	if err != nil {
		h.fail(c, err)
		return
	}
	ctx := c.Request.Context()
	if c.Request.Method == http.MethodGet {
		result, err := h.services.Credits.VideoPricing(ctx, id)
		h.imageReply(c, result, err, 200)
		return
	}
	var input credits.VideoPricing
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	input.ModelID = id
	result, err := h.services.Credits.SaveVideoPricing(ctx, p.Actor, input)
	h.imageReply(c, result, err, 200)
}
