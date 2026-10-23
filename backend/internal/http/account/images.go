package account

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/images"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
)

func (h *Handler) imageRoutes(protected, admin *gin.RouterGroup) {
	protected.GET("/image-options", h.imageOptions)
	protected.POST("/files", h.csrf, h.imageLimit, h.imageUpload)
	protected.GET("/files/:id", h.imageBytes)
	protected.GET("/files/:id/thumb", h.imageBytes)
	protected.GET("/files/:id/metadata", h.imageFileMetadata)
	protected.GET("/me/files", h.imageLibrary)
	protected.GET("/image-conversations", h.imageConversations)
	protected.POST("/image-conversations", h.csrf, h.imageLimit, h.imageCreateConversation)
	protected.GET("/image-conversations/:id", h.imageConversation)
	protected.PATCH("/image-conversations/:id", h.csrf, h.imageLimit, h.imageUpdateConversation)
	protected.DELETE("/image-conversations/:id", h.csrf, h.imageLimit, h.imageDeleteConversation)
	protected.POST("/image-tasks", h.csrf, h.imageLimit, h.imageSubmit)
	protected.GET("/image-tasks", h.imageTaskList)
	protected.GET("/image-tasks/:id", h.imageTask)
	protected.GET("/image-tasks/:id/events", h.imageEvents)
	protected.POST("/image-tasks/:id/cancel", h.csrf, h.imageCancel)
	protected.GET("/me/images", h.imageGallery)
	protected.DELETE("/me/images/:id", h.csrf, h.imageLimit, h.imageDeleteFile)
	admin.GET("/image-tasks", h.imageTaskList)
	admin.GET("/image-tasks/:id", h.imageTask)
	admin.DELETE("/images/:id", h.csrf, h.adminLimit, h.imageDeleteFile)
	admin.GET("/image-settings", h.imageOptions)
	admin.PUT("/image-settings", h.csrf, h.adminLimit, h.imageSaveSettings)
}
func (h *Handler) imageLimit(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	allowed, retry, err := h.services.Gate.Allow(c.Request.Context(), "image-mutate", p.User.ID.String(), 30, time.Minute)
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
func (h *Handler) imageReply(c *gin.Context, result any, err error, status int) {
	if err != nil {
		h.fail(c, err)
		return
	}
	if status == 204 {
		c.Status(status)
	} else {
		c.JSON(status, result)
	}
}
func (h *Handler) imageOptions(c *gin.Context) {
	result, err := h.services.Images.Configuration(c.Request.Context())
	if !strings.Contains(c.FullPath(), "/admin/") {
		result.AdminCanViewContent = false
	}
	h.imageReply(c, result, err, 200)
}
func (h *Handler) imageSaveSettings(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	p, _ := principal(c)
	var input images.Configuration
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Images.SaveConfiguration(c.Request.Context(), p.Actor, input)
	h.imageReply(c, result, err, 200)
}
func (h *Handler) imageConversations(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	_, _, limit, err := pageArguments(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Images.Conversations(c.Request.Context(), p.User.ID, c.Query("search"), c.Query("cursor"), limit)
	h.imageReply(c, result, err, 200)
}
func (h *Handler) imageCreateConversation(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	var input struct {
		ID      uuid.UUID `json:"id"`
		ModelID uuid.UUID `json:"model_id"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Images.CreateConversation(c.Request.Context(), p.Actor, input.ID, input.ModelID)
	h.imageReply(c, result, err, 201)
}
func (h *Handler) imageConversation(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Images.GetConversation(c.Request.Context(), p.User.ID, id)
	h.imageReply(c, result, err, 200)
}
func (h *Handler) imageUpdateConversation(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	var input struct {
		Title   string `json:"title"`
		Pinned  bool   `json:"pinned"`
		Version int64  `json:"version"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Images.UpdateConversation(c.Request.Context(), p.Actor, id, input.Title, input.Pinned, input.Version)
	h.imageReply(c, result, err, 200)
}
func (h *Handler) imageDeleteConversation(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	h.imageReply(c, nil, h.services.Images.RemoveConversation(c.Request.Context(), p.Actor, id), 204)
}
func (h *Handler) imageSubmit(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	var input images.Input
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Images.Submit(c.Request.Context(), p.Actor, c.GetHeader("Idempotency-Key"), input)
	h.imageReply(c, result, err, 202)
}
func imageFilter(c *gin.Context) (images.Filter, error) {
	from, until, limit, err := pageArguments(c)
	if err != nil {
		return images.Filter{}, err
	}
	f := images.Filter{State: c.Query("state"), Quality: c.Query("quality"), Cursor: c.Query("cursor"), From: from, Until: until, Limit: limit}
	if value := c.Query("conversation_id"); value != "" {
		id, err := identifier(value)
		if err != nil {
			return f, err
		}
		f.Conversation = &id
	}
	if value := c.Query("user_id"); value != "" {
		id, err := identifier(value)
		if err != nil {
			return f, err
		}
		f.Owner = &id
	}
	return f, nil
}
func (h *Handler) imageTaskList(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	admin := strings.Contains(c.FullPath(), "/admin/")
	if admin && !h.checkAdmin(c) {
		return
	}
	f, err := imageFilter(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Images.List(c.Request.Context(), p.Actor, f, admin)
	h.imageReply(c, result, err, 200)
}
func (h *Handler) imageTask(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	admin := strings.Contains(c.FullPath(), "/admin/")
	if admin && !h.checkAdmin(c) {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Images.Get(c.Request.Context(), p.Actor, id, admin)
	h.imageReply(c, result, err, 200)
}
func (h *Handler) imageCancel(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Images.Cancel(c.Request.Context(), p.Actor, id)
	h.imageReply(c, result, err, 200)
}
func (h *Handler) imageGallery(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	filter, err := imageFilter(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Images.Gallery(c.Request.Context(), p.User.ID, filter)
	h.imageReply(c, result, err, 200)
}
func (h *Handler) imageLibrary(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	_, _, limit, err := pageArguments(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Images.ReferenceLibrary(c.Request.Context(), p.User.ID, c.Query("cursor"), limit)
	h.imageReply(c, result, err, 200)
}
func (h *Handler) imageDeleteFile(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	admin := strings.Contains(c.FullPath(), "/admin/")
	if admin && !h.checkAdmin(c) {
		return
	}
	h.imageReply(c, nil, h.services.Images.DeleteFile(c.Request.Context(), p.Actor, id, admin), 204)
}
func (h *Handler) imageUpload(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	cfg, err := h.services.Images.Configuration(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	kind := c.DefaultQuery("kind", "upload")
	limit := cfg.MaxUploadBytes
	if kind == "avatar" {
		limit = 2 << 20
	} else if kind != "upload" {
		h.fail(c, problem.Invalid())
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit+(1<<20))
	reader, err := c.Request.MultipartReader()
	if err != nil {
		h.fail(c, problem.Invalid())
		return
	}
	part, err := reader.NextPart()
	if err != nil {
		h.fail(c, problem.Invalid())
		return
	}
	if part.FormName() != "file" || part.FileName() == "" {
		h.fail(c, problem.Invalid())
		return
	}
	data, readErr := io.ReadAll(io.LimitReader(part, limit+1))
	closeErr := part.Close()
	if readErr != nil || closeErr != nil || int64(len(data)) > limit {
		h.fail(c, problem.New("FILE_TOO_LARGE", 413))
		return
	}
	extra, err := reader.NextPart()
	if extra != nil {
		if closeErr := extra.Close(); closeErr != nil {
			h.logger.Error("close extra upload part failed")
		}
		h.fail(c, problem.Invalid())
		return
	}
	if !errors.Is(err, io.EOF) {
		h.fail(c, problem.Invalid())
		return
	}
	result, err := h.services.Files.Upload(c.Request.Context(), p.Actor, kind, data, limit)
	h.imageReply(c, result, err, 201)
}
func (h *Handler) imageFileMetadata(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	row, err := h.services.Files.GetForAdmin(c.Request.Context(), id)
	if err != nil {
		h.fail(c, err)
		return
	}
	if row.UserID != p.User.ID {
		if p.User.Role != "admin" {
			h.fail(c, problem.New("FILE_NOT_FOUND", 404))
			return
		}
		if err := h.services.Images.AllowFileView(c.Request.Context(), p.Actor, id); err != nil {
			h.fail(c, err)
			return
		}
	}
	c.JSON(200, h.services.Files.View(row, p.User.ID))
}
func (h *Handler) imageBytes(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	thumb := strings.HasSuffix(c.FullPath(), "/thumb")
	expires, err := strconv.ParseInt(c.Query("expires"), 10, 64)
	if err != nil || !h.services.Files.Verify(id, p.User.ID, thumb, expires, c.Query("sig")) {
		h.fail(c, problem.New("FILE_NOT_FOUND", 404))
		return
	}
	row, err := h.services.Files.GetForAdmin(c.Request.Context(), id)
	if err != nil {
		h.fail(c, err)
		return
	}
	if row.UserID != p.User.ID {
		if p.User.Role != "admin" {
			h.fail(c, problem.New("FILE_NOT_FOUND", 404))
			return
		}
		if err := h.services.Images.AllowFileView(c.Request.Context(), p.Actor, id); err != nil {
			h.fail(c, err)
			return
		}
	}
	file, mime, err := h.services.Files.Open(c.Request.Context(), row, thumb)
	if err != nil {
		h.fail(c, err)
		return
	}
	defer func() {
		if err := file.Close(); err != nil {
			h.logger.Error("close served image failed")
		}
	}()
	c.Header("Content-Type", mime)
	c.Header("Cache-Control", "private, no-store")
	c.Header("Content-Disposition", `inline; filename="`+id.String()+map[bool]string{true: ".webp", false: ".png"}[thumb]+`"`)
	http.ServeContent(c.Writer, c.Request, row.ID.String(), row.CreatedAt, file)
}
func (h *Handler) imageEvents(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	task, err := h.services.Images.Get(c.Request.Context(), p.Actor, id, false)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-store")
	c.Header("X-Accel-Buffering", "no")
	c.Status(200)
	controller := http.NewResponseController(c.Writer)
	emit := func(kind string, task *images.Task) error {
		if err := controller.SetWriteDeadline(time.Now().Add(10 * time.Second)); err != nil && !errors.Is(err, http.ErrNotSupported) {
			return err
		}
		payload, err := json.Marshal(struct {
			Task *images.Task `json:"task,omitempty"`
		}{task})
		if err != nil {
			return fmt.Errorf("encode image event: %w", err)
		}
		if _, err := fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", kind, payload); err != nil {
			return err
		}
		return controller.Flush()
	}
	if err := emit("task", &task); err != nil {
		return
	}
	if images.Terminal(task.Status) {
		if err := emit("done", &task); err != nil {
			return
		}
		return
	}
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	_, token, _ := strings.Cut(c.GetHeader("Authorization"), " ")
	for {
		select {
		case <-c.Request.Context().Done():
			return
		case <-heartbeat.C:
			if err := emit("ping", nil); err != nil {
				return
			}
		case <-ticker.C:
			if _, err := h.services.Auth.Authenticate(c.Request.Context(), token, p.Actor.IP); err != nil {
				return
			}
			current, err := h.services.Images.Get(c.Request.Context(), p.Actor, id, false)
			if err != nil {
				return
			}
			if current.Version != task.Version || current.QueuePosition != task.QueuePosition {
				task = current
				if err := emit("task", &task); err != nil {
					return
				}
			}
			if images.Terminal(current.Status) {
				if err := emit("done", &current); err != nil {
					return
				}
				return
			}
		}
	}
}
