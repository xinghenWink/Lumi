package account

import (
	"errors"
	"net/http"
	"path/filepath"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/videos"
)

func (h *Handler) videoRoutes(api, protected *gin.RouterGroup) {
	protected.GET("/video-options", h.videoOptions)
	protected.POST("/video-tasks/quote", h.csrf, h.imageLimit, h.videoQuote)
	protected.POST("/video-tasks", h.csrf, h.imageLimit, h.videoSubmit)
	protected.GET("/video-tasks", h.videoList)
	protected.GET("/video-tasks/:id", h.videoTask)
	protected.GET("/video-assets", h.videoAssets)
	protected.GET("/video-assets/:id", h.videoAsset)
	protected.POST("/video-assets", h.csrf, h.imageLimit, h.videoUpload)
	api.GET("/video-media/:id/:kind", h.videoMedia)
	api.HEAD("/video-media/:id/:kind", h.videoMedia)
}

func (h *Handler) videoService(c *gin.Context) *videos.Service {
	if h.services.Videos == nil {
		h.fail(c, problem.New("DEPENDENCY_UNAVAILABLE", 503))
	}
	return h.services.Videos
}

func (h *Handler) videoOptions(c *gin.Context) {
	s := h.videoService(c)
	if s == nil {
		return
	}
	choices, err := s.Options(c.Request.Context())
	h.imageReply(c, gin.H{"items": choices}, err, 200)
}

func (h *Handler) videoQuote(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	s := h.videoService(c)
	if s == nil {
		return
	}
	var input videos.Input
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	quote, err := s.Quote(c.Request.Context(), p.Actor, input)
	h.imageReply(c, quote, err, 200)
}

func (h *Handler) videoSubmit(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	s := h.videoService(c)
	if s == nil {
		return
	}
	var input videos.Submission
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := s.Submit(c.Request.Context(), p.Actor, c.GetHeader("Idempotency-Key"), input)
	if err != nil {
		var failure *problem.Error
		if errors.As(err, &failure) && failure.Code == "VIDEO_QUOTE_CHANGED" {
			if quote, quoteErr := s.Quote(c.Request.Context(), p.Actor, input.Input); quoteErr == nil {
				c.JSON(409, gin.H{"code": failure.Code, "quote": quote})
				return
			}
		}
	}
	h.imageReply(c, result, err, 202)
}

func (h *Handler) videoList(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	s := h.videoService(c)
	if s == nil {
		return
	}
	canvas, err := optionalID(c.Query("canvas_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	page, err := s.List(c.Request.Context(), p.User.ID, canvas, c.Query("cursor"))
	h.imageReply(c, page, err, 200)
}

func (h *Handler) videoTask(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	s := h.videoService(c)
	if s == nil {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	task, err := s.Get(c.Request.Context(), p.User.ID, id)
	h.imageReply(c, task, err, 200)
}

func (h *Handler) videoAssets(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	s := h.videoService(c)
	if s == nil {
		return
	}
	page, err := s.Assets(c.Request.Context(), p.User.ID, c.Query("cursor"))
	h.imageReply(c, page, err, 200)
}

func (h *Handler) videoAsset(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	s := h.videoService(c)
	if s == nil {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	file, err := s.Asset(c.Request.Context(), p.User.ID, id)
	h.imageReply(c, file, err, 200)
}

func (h *Handler) videoUpload(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	s := h.videoService(c)
	if s == nil {
		return
	}
	kind := c.Query("kind")
	var limit int64
	switch kind {
	case "image":
		limit = 10 << 20
	case "audio":
		limit = videos.MaxAudioUpload
	case "video":
		limit = videos.MaxVideoUpload
	default:
		h.fail(c, problem.Invalid())
		return
	}
	if c.Request.ContentLength > limit {
		h.fail(c, problem.New("FILE_TOO_LARGE", 413))
		return
	}
	file, err := s.Upload(c.Request.Context(), p.Actor, kind, c.Request.Body)
	h.imageReply(c, file, err, 201)
}

func (h *Handler) videoMedia(c *gin.Context) {
	s := h.videoService(c)
	if s == nil {
		return
	}
	id, idErr := uuid.Parse(c.Param("id"))
	kind := c.Param("kind")
	param := "owner"
	if kind == "reference" {
		param = "task"
	}
	scope, scopeErr := uuid.Parse(c.Query(param))
	expires, timeErr := strconv.ParseInt(c.Query("expires"), 10, 64)
	if idErr != nil || scopeErr != nil || timeErr != nil {
		h.fail(c, problem.New("FILE_NOT_FOUND", 404))
		return
	}
	ctx := c.Request.Context()
	row, err := s.Media(ctx, id, scope, kind, expires, c.Query("sig"))
	if err != nil {
		h.fail(c, err)
		return
	}
	file, mime, err := h.services.Files.Open(ctx, row, false)
	if err != nil {
		h.fail(c, err)
		return
	}
	defer func() {
		if err := file.Close(); err != nil {
			h.logger.ErrorContext(ctx, "close served video media failed")
		}
	}()
	c.Header("Content-Type", mime)
	c.Header("Cache-Control", "private, no-store")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("Content-Disposition", `inline; filename="`+id.String()+filepath.Ext(file.Name())+`"`)
	http.ServeContent(c.Writer, c.Request, row.ID.String(), row.CreatedAt, file)
}
