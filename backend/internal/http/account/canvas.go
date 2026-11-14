package account

import (
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/xinghenWink/Lumi/backend/internal/canvas"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
)

func (h *Handler) canvasRoutes(protected *gin.RouterGroup) {
	protected.GET("/canvases", h.canvasList)
	protected.POST("/canvases", h.csrf, h.canvasLimit, h.canvasCreate)
	protected.GET("/canvases/:id", h.canvasGet)
	protected.PUT("/canvases/:id", h.csrf, h.canvasLimit, h.canvasSave)
	protected.POST("/canvases/:id/runs", h.csrf, h.imageLimit, h.canvasRun)
	protected.POST("/canvases/:id/text-runs", h.csrf, h.canvasLimit, h.canvasTextSubmit)
	protected.GET("/canvases/:id/text-runs/:run", h.canvasTextResult)
	protected.POST("/canvases/:id/text-runs/:run/cancel", h.csrf, h.canvasLimit, h.canvasTextResult)
	protected.DELETE("/canvases/:id", h.csrf, h.canvasLimit, h.canvasDelete)
}
func (h *Handler) canvasTextSubmit(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	var input canvas.TextRunInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Canvas.SubmitText(c.Request.Context(), h.services.Chat, p.Actor, id, c.GetHeader("Idempotency-Key"), input)
	h.imageReply(c, result, err, 202)
}

func (h *Handler) canvasTextResult(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	run, err := identifier(c.Param("run"))
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Canvas.TextRun(c.Request.Context(), p.User.ID, id, run, c.Request.Method == "POST")
	h.imageReply(c, result, err, 200)
}
func (h *Handler) canvasRun(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	var input canvas.RunInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Canvas.Run(c.Request.Context(), h.services.Images, p.Actor, id, c.GetHeader("Idempotency-Key"), input)
	h.imageReply(c, result, err, 202)
}

// canvasLimit allows debounced autosave during continuous editing while bounding abuse.
func (h *Handler) canvasLimit(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	allowed, retry, err := h.services.Gate.Allow(c.Request.Context(), "canvas-write", p.User.ID.String(), 120, time.Minute)
	if err != nil {
		h.fail(c, err)
		return
	}
	if !allowed {
		h.fail(c, problem.Retry("RATE_LIMITED", retry))
		return
	}
	c.Next()
}
func (h *Handler) canvasList(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	limit, err := strconv.ParseInt(c.DefaultQuery("limit", "20"), 10, 32)
	if err != nil || limit < 1 || limit > 100 {
		h.fail(c, problem.Invalid())
		return
	}
	result, err := h.services.Canvas.List(c.Request.Context(), p.User.ID, c.Query("search"), c.Query("cursor"), int32(limit))
	h.imageReply(c, result, err, 200)
}
func (h *Handler) canvasCreate(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	var input canvas.CreateInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Canvas.Create(c.Request.Context(), p.Actor, input)
	h.imageReply(c, result, err, 201)
}
func (h *Handler) canvasGet(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Canvas.Get(c.Request.Context(), p.User.ID, id)
	h.imageReply(c, result, err, 200)
}
func (h *Handler) canvasSave(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	var input canvas.SaveInput
	if err := decodeLimit(c, &input, canvas.MaxRequestBytes); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Canvas.Save(c.Request.Context(), p.Actor, id, input)
	h.imageReply(c, result, err, 200)
}
func (h *Handler) canvasDelete(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	h.imageReply(c, nil, h.services.Canvas.Delete(c.Request.Context(), p.Actor, id), 204)
}
