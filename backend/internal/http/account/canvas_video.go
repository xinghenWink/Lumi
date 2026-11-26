package account

import (
	"errors"

	"github.com/gin-gonic/gin"
	"github.com/xinghenWink/Lumi/backend/internal/canvas"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
)

func (h *Handler) canvasVideoQuote(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	service := h.videoService(c)
	if service == nil {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	var input canvas.VideoQuoteInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	quote, err := h.services.Canvas.VideoQuote(c.Request.Context(), service, p.Actor, id, input)
	h.imageReply(c, quote, err, 200)
}

func (h *Handler) canvasVideoRun(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	service := h.videoService(c)
	if service == nil {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	var input canvas.VideoRunInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Canvas.RunVideo(c.Request.Context(), service, p.Actor, id, c.GetHeader("Idempotency-Key"), input)
	var failure *problem.Error
	if errors.As(err, &failure) && failure.Code == "VIDEO_QUOTE_CHANGED" {
		if quote, quoteErr := h.services.Canvas.VideoQuote(c.Request.Context(), service, p.Actor, id, input.VideoQuoteInput); quoteErr == nil {
			c.JSON(409, gin.H{"code": failure.Code, "quote": quote})
			return
		}
	}
	h.imageReply(c, result, err, 202)
}
