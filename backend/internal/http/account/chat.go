package account

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/chat"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
)

func (h *Handler) chatRoutes(protected, admin *gin.RouterGroup) {
	protected.GET("/conversations", h.chatList)
	protected.POST("/conversations", h.csrf, h.chatMutationLimit, h.chatCreate)
	protected.POST("/conversations/delete", h.csrf, h.chatMutationLimit, h.chatDelete)
	protected.GET("/conversations/:id", h.chatGet)
	protected.PATCH("/conversations/:id", h.csrf, h.chatMutationLimit, h.chatUpdate)
	protected.GET("/conversations/:id/messages", h.chatMessages)
	protected.POST("/conversations/:id/messages", h.csrf, h.chatSend)
	protected.POST("/conversations/:id/stop", h.csrf, h.chatStop)
	admin.GET("/chat-settings", h.chatSettings)
	admin.PUT("/chat-settings", h.csrf, h.adminLimit, h.chatSaveSettings)
}
func (h *Handler) chatMutationLimit(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	allowed, retry, err := h.services.Gate.Allow(c.Request.Context(), "chat-manage", p.User.ID.String(), 60, time.Minute)
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
func (h *Handler) chatList(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	_, _, limit, err := pageArguments(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Chat.List(c.Request.Context(), p.User.ID, c.Query("search"), c.Query("cursor"), limit)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(200, result)
}
func (h *Handler) chatCreate(c *gin.Context) {
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
	result, err := h.services.Chat.Create(c.Request.Context(), p.User.ID, input.ID, input.ModelID)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(201, result)
}
func (h *Handler) chatGet(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Chat.Conversation(c.Request.Context(), p.User.ID, id)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(200, result)
}
func (h *Handler) chatUpdate(c *gin.Context) {
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
	result, err := h.services.Chat.Update(c.Request.Context(), p.User.ID, id, input.Title, input.Pinned, input.Version)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(200, result)
}
func (h *Handler) chatDelete(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	var input struct {
		IDs []uuid.UUID `json:"ids"`
		All bool        `json:"all"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	if err := h.services.Chat.Delete(c.Request.Context(), p.User.ID, input.IDs, input.All); err != nil {
		h.fail(c, err)
		return
	}
	c.Status(204)
}
func (h *Handler) chatMessages(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	_, _, limit, err := pageArguments(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Chat.Messages(c.Request.Context(), p.User.ID, id, c.Query("cursor"), limit)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(200, result)
}
func (h *Handler) chatStop(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	if err := h.services.Chat.Stop(c.Request.Context(), p.User.ID, id); err != nil {
		h.fail(c, err)
		return
	}
	c.Status(204)
}
func (h *Handler) chatSettings(c *gin.Context) {
	result, err := h.services.Chat.Configuration(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(200, result)
}
func (h *Handler) chatSaveSettings(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	var input chat.Configuration
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Chat.SaveConfiguration(c.Request.Context(), p.Actor, input)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(200, result)
}
func (h *Handler) chatSend(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	var input chat.SendInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	_, token, _ := strings.Cut(c.GetHeader("Authorization"), " ")
	opened := false
	emit := func(event chat.Event) error {
		encoded, err := json.Marshal(event)
		if err != nil {
			return fmt.Errorf("encode chat event: %w", err)
		}
		if !opened {
			c.Header("Content-Type", "text/event-stream; charset=utf-8")
			c.Header("Cache-Control", "no-store")
			c.Header("X-Accel-Buffering", "no")
			c.Header("X-Content-Type-Options", "nosniff")
			c.Status(http.StatusOK)
			opened = true
		}
		controller := http.NewResponseController(c.Writer)
		if err := controller.SetWriteDeadline(time.Now().Add(10 * time.Second)); err != nil && !errors.Is(err, http.ErrNotSupported) {
			return fmt.Errorf("set SSE write deadline: %w", err)
		}
		if _, err := fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event.Type, encoded); err != nil {
			return fmt.Errorf("write chat event: %w", err)
		}
		c.Writer.Flush()
		return nil
	}
	verify := func(ctx context.Context) error {
		_, err := h.services.Auth.Authenticate(ctx, token, p.Actor.IP)
		return err
	}
	err = h.services.Chat.Stream(c.Request.Context(), p.Actor, id, input, emit, verify)
	if err != nil {
		if !opened {
			h.fail(c, err)
		} else if c.Request.Context().Err() == nil {
			// A stream cannot switch back to a JSON error response after its first event.
			if emitErr := emit(chat.Event{Type: "error", Code: "CHAT_INTERRUPTED", Message: "CHAT_INTERRUPTED"}); emitErr != nil {
				h.logger.Debug("chat error delivery stopped")
			}
		}
	}
}
