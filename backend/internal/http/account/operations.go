package account

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/auth"
	"github.com/xinghenWink/Lumi/backend/internal/chat"
	"github.com/xinghenWink/Lumi/backend/internal/operations"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	platformredis "github.com/xinghenWink/Lumi/backend/internal/platform/redis"
	"github.com/xinghenWink/Lumi/backend/internal/settings"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

func (h *Handler) m6Routes(protected, admin *gin.RouterGroup) {
	protected.GET("/me/preferences", h.preferences)
	protected.PUT("/me/preferences", h.csrf, h.savePreferences)
	protected.GET("/me/sessions", h.devices)
	protected.DELETE("/me/sessions/:id", h.csrf, h.revokeDevice)
	protected.DELETE("/me", h.csrf, h.deleteSelf)
	protected.GET("/me/chat-export", h.exportChats)
	protected.GET("/conversations/:id/export", h.exportChats)
	protected.GET("/conversations/:id/events", h.resumeChat)
	protected.GET("/announcements", h.announcements)
	protected.POST("/me/images/batch-download", h.csrf, h.imageLimit, h.downloadImages)
	protected.POST("/me/images/batch-delete", h.csrf, h.imageLimit, h.deleteImages)
	admin.GET("/dashboard", h.dashboard)
	admin.POST("/users/batch", h.csrf, h.adminLimit, h.batchUsers)
	admin.GET("/users/export", h.exportUsers)
	admin.DELETE("/users/:id/sessions", h.csrf, h.adminLimit, h.revokeAllDevices)
	admin.GET("/conversations", h.adminChats)
	admin.GET("/conversations/:id/messages", h.adminChatContent)
	admin.GET("/announcements", h.announcements)
	admin.POST("/announcements", h.csrf, h.adminLimit, h.saveAnnouncement)
	admin.PUT("/announcements/:id", h.csrf, h.adminLimit, h.saveAnnouncement)
	admin.DELETE("/announcements/:id", h.csrf, h.adminLimit, h.deleteAnnouncement)
	admin.GET("/operations-settings", h.operationsSettings)
	admin.PUT("/operations-settings", h.csrf, h.adminLimit, h.saveOperationsSettings)
	admin.POST("/mail/test", h.csrf, h.adminLimit, h.testMail)
	admin.GET("/system", h.systemInfo)
	admin.POST("/system/cleanup", h.csrf, h.adminLimit, h.cleanupImages)
	admin.POST("/image-tasks/:id/refund", h.csrf, h.adminLimit, h.refundTask)
}
func (h *Handler) maintenance(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	if p.User.Role == "admin" {
		c.Next()
		return
	}
	cfg, err := h.services.Settings.Read(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	if cfg.Operations.Maintenance {
		h.fail(c, problem.New("MAINTENANCE", 503))
		return
	}
	c.Next()
}
func (h *Handler) forgotPassword(c *gin.Context) {
	var input auth.CodeInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	h.imageReply(c, nil, h.services.Auth.ForgotPassword(c.Request.Context(), input, client(c), h.services.PublicBaseURL), 204)
}
func (h *Handler) resetPassword(c *gin.Context) {
	var input auth.ResetInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	err := h.services.Auth.ResetPassword(c.Request.Context(), input, client(c))
	if err == nil {
		h.clearCookie(c)
	}
	h.imageReply(c, nil, err, 204)
}
func (h *Handler) preferences(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	v, err := h.services.Users.Preferences(c.Request.Context(), p.User.ID)
	h.imageReply(c, v, err, 200)
}
func (h *Handler) savePreferences(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	var input user.Preferences
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	v, err := h.services.Users.SavePreferences(c.Request.Context(), p.Actor, input)
	h.imageReply(c, v, err, 200)
}
func (h *Handler) devices(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	v, err := h.services.Users.Devices(c.Request.Context(), p.User.ID)
	h.imageReply(c, gin.H{"items": v, "current_id": p.FamilyID}, err, 200)
}
func (h *Handler) revokeDevice(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	err = h.services.Users.RevokeDevices(c.Request.Context(), p.Actor, p.User.ID, &id, false)
	if err == nil && id == p.FamilyID {
		h.clearCookie(c)
	}
	h.imageReply(c, nil, err, 204)
}
func (h *Handler) revokeAllDevices(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	p, _ := principal(c)
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	h.imageReply(c, nil, h.services.Users.RevokeDevices(c.Request.Context(), p.Actor, id, nil, true), 204)
}
func (h *Handler) deleteSelf(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	err := h.services.Users.DeleteSelf(c.Request.Context(), p.Actor, input.Email, input.Password)
	if err == nil {
		h.clearCookie(c)
	}
	h.imageReply(c, nil, err, 204)
}
func (h *Handler) dashboard(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	days, err := strconv.ParseInt(c.DefaultQuery("days", "7"), 10, 32)
	if err != nil || (days != 1 && days != 7 && days != 30) {
		h.fail(c, problem.Invalid())
		return
	}
	v, err := h.services.Operations.Dashboard(c.Request.Context(), int32(days))
	h.imageReply(c, v, err, 200)
}
func (h *Handler) batchUsers(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	p, _ := principal(c)
	var input struct {
		IDs     []uuid.UUID `json:"ids"`
		Action  string      `json:"action"`
		Amount  int64       `json:"amount"`
		Note    string      `json:"note"`
		Confirm bool        `json:"confirm"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	var err error
	if input.Action == "grant" {
		err = h.services.Credits.BatchGrant(c.Request.Context(), p.Actor, input.IDs, c.GetHeader("Idempotency-Key"), input.Amount, input.Note)
	} else {
		if input.Action == "delete" && !input.Confirm {
			h.fail(c, problem.Invalid())
			return
		}
		err = h.services.Users.Batch(c.Request.Context(), p.Actor, input.IDs, input.Action)
	}
	h.imageReply(c, nil, err, 204)
}
func (h *Handler) announcements(c *gin.Context) {
	admin := strings.Contains(c.FullPath(), "/admin/")
	if admin && !h.checkAdmin(c) {
		return
	}
	_, _, limit, err := pageArguments(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	v, err := h.services.Operations.Announcements(c.Request.Context(), !admin, c.Query("cursor"), limit)
	h.imageReply(c, v, err, 200)
}
func (h *Handler) saveAnnouncement(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	p, _ := principal(c)
	var input operations.Announcement
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	id := uuid.Nil
	var err error
	if c.Param("id") != "" {
		id, err = identifier(c.Param("id"))
		if err != nil {
			h.fail(c, err)
			return
		}
	}
	v, err := h.services.Operations.SaveAnnouncement(c.Request.Context(), p.Actor, id, input, false)
	h.imageReply(c, v, err, 200)
}
func (h *Handler) deleteAnnouncement(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	p, _ := principal(c)
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	_, err = h.services.Operations.SaveAnnouncement(c.Request.Context(), p.Actor, id, operations.Announcement{}, true)
	h.imageReply(c, nil, err, 204)
}
func (h *Handler) operationsSettings(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	v, err := h.services.Settings.OperationsView(c.Request.Context())
	h.imageReply(c, v, err, 200)
}
func (h *Handler) saveOperationsSettings(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	p, _ := principal(c)
	var input settings.OperationsInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	v, err := h.services.Settings.SaveOperations(c.Request.Context(), p.Actor, input)
	h.imageReply(c, v, err, 200)
}
func (h *Handler) testMail(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	p, _ := principal(c)
	if err := h.services.Operations.AuditAction(c.Request.Context(), p.Actor, "mail.test"); err != nil {
		h.fail(c, err)
		return
	}
	h.imageReply(c, nil, h.services.Mailer.SendTest(c.Request.Context(), p.User.Email, p.User.Locale), 204)
}
func (h *Handler) systemInfo(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	dbOK := h.services.Operations.CheckDatabase(ctx) == nil
	cache, ok := h.services.Gate.(interface{ Ping(context.Context) error })
	redisOK := ok && cache.Ping(ctx) == nil
	size, err := h.services.Files.Usage(ctx)
	h.imageReply(c, gin.H{"version": h.services.Version, "commit": h.services.Commit, "build_time": h.services.BuildTime, "uptime_seconds": int64(time.Since(h.services.Operations.StartedAt).Seconds()), "database_ok": dbOK, "redis_ok": redisOK, "image_bytes": size}, err, 200)
}
func (h *Handler) cleanupImages(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	p, _ := principal(c)
	if err := h.services.Operations.AuditAction(c.Request.Context(), p.Actor, "system.cleanup"); err != nil {
		h.fail(c, err)
		return
	}
	cfg, err := h.services.Images.Configuration(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	h.imageReply(c, nil, h.services.Files.Cleanup(c.Request.Context(), cfg.RetentionDays), 204)
}
func (h *Handler) refundTask(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	p, _ := principal(c)
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	var input struct {
		Note string `json:"note"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	h.imageReply(c, nil, h.services.Images.ManualRefund(c.Request.Context(), p.Actor, id, input.Note), 204)
}
func (h *Handler) adminChats(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	owner, err := optionalID(c.Query("user_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	_, _, limit, err := pageArguments(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	v, err := h.services.Operations.Chats(c.Request.Context(), owner, c.Query("cursor"), limit)
	h.imageReply(c, v, err, 200)
}
func (h *Handler) adminChatContent(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	p, _ := principal(c)
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	cfg, err := h.services.Images.Configuration(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	if !cfg.AdminCanViewContent {
		h.fail(c, problem.Forbidden())
		return
	}
	owner, err := identifier(c.Query("user_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	if err := h.services.Operations.AuditContent(c.Request.Context(), p.Actor, id); err != nil {
		h.fail(c, err)
		return
	}
	_, _, limit, err := pageArguments(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	v, err := h.services.Chat.Messages(c.Request.Context(), owner, id, c.Query("cursor"), limit)
	h.imageReply(c, v, err, 200)
}
func (h *Handler) exportChats(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	var id *uuid.UUID
	var err error
	if c.Param("id") != "" {
		id, err = optionalID(c.Param("id"))
		if err != nil {
			h.fail(c, err)
			return
		}
	}
	format := c.DefaultQuery("format", "json")
	if format != "json" && format != "markdown" {
		h.fail(c, problem.Invalid())
		return
	}
	rows, err := h.services.Chat.Export(c.Request.Context(), p.User.ID, id)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.Header("Content-Disposition", "attachment; filename=lumi-chats."+map[string]string{"json": "json", "markdown": "md"}[format])
	if format == "markdown" {
		c.Data(200, "text/markdown; charset=utf-8", []byte(chat.MarkdownExport(rows)))
	} else {
		c.JSON(200, rows)
	}
}
func (h *Handler) exportUsers(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	p, _ := principal(c)
	if err := h.services.Operations.AuditAction(c.Request.Context(), p.Actor, "user.export"); err != nil {
		h.fail(c, err)
		return
	}
	var buffer bytes.Buffer
	writer := csv.NewWriter(&buffer)
	catalog, catalogErr := loadCSVCatalog(p.User.Locale)
	if catalogErr != nil {
		h.fail(c, catalogErr)
		return
	}
	if err := writer.Write(catalog.UserHeaders); err != nil {
		h.fail(c, err)
		return
	}
	cursor := ""
	for {
		page, err := h.services.Users.List(c.Request.Context(), user.Filter{Search: c.Query("search"), Role: c.Query("role"), Status: c.Query("status"), Sort: "created_at", Cursor: cursor, Limit: 100})
		if err != nil {
			h.fail(c, err)
			return
		}
		for _, row := range page.Items {
			if err := writer.Write([]string{row.ID.String(), csvCell(row.Email), csvCell(row.Nickname), row.Role, row.Status, row.CreatedAt.Format(time.RFC3339)}); err != nil {
				h.fail(c, err)
				return
			}
		}
		writer.Flush()
		if err := writer.Error(); err != nil {
			h.fail(c, err)
			return
		}
		if buffer.Len() > 32<<20 {
			h.fail(c, problem.New("EXPORT_TOO_LARGE", 413))
			return
		}
		cursor = page.NextCursor
		if cursor == "" {
			break
		}
	}
	c.Header("Content-Disposition", "attachment; filename=lumi-users.csv")
	c.Data(200, "text/csv; charset=utf-8", buffer.Bytes())
}
func (h *Handler) downloadImages(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	var input struct {
		IDs []uuid.UUID `json:"ids"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	if len(input.IDs) < 1 || len(input.IDs) > 50 {
		h.fail(c, problem.Invalid())
		return
	}
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, id := range input.IDs {
		row, err := h.services.Files.Get(c.Request.Context(), p.User.ID, id)
		if err != nil {
			h.fail(c, err)
			return
		}
		if row.Kind != "generated" {
			h.fail(c, problem.New("FILE_NOT_FOUND", 404))
			return
		}
		file, _, err := h.services.Files.Open(c.Request.Context(), row, false)
		if err != nil {
			h.fail(c, err)
			return
		}
		entry, err := writer.Create(id.String() + ".png")
		if err != nil {
			if closeErr := file.Close(); closeErr != nil {
				h.logger.Debug("close ZIP source failed")
			}
			h.fail(c, err)
			return
		}
		_, copyErr := io.Copy(entry, io.LimitReader(file, 20<<20+1))
		closeErr := file.Close()
		if copyErr != nil || closeErr != nil {
			h.fail(c, problem.New("INTERNAL_ERROR", 500))
			return
		}
		if buffer.Len() > 100<<20 {
			h.fail(c, problem.New("EXPORT_TOO_LARGE", 413))
			return
		}
	}
	if err := writer.Close(); err != nil {
		h.fail(c, err)
		return
	}
	c.Header("Content-Disposition", "attachment; filename=lumi-images.zip")
	c.Data(200, "application/zip", buffer.Bytes())
}
func (h *Handler) deleteImages(c *gin.Context) {
	p, ok := principal(c)
	if !ok {
		return
	}
	var input struct {
		IDs []uuid.UUID `json:"ids"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	h.imageReply(c, nil, h.services.Images.BatchDelete(c.Request.Context(), p.Actor, input.IDs), 204)
}
func (h *Handler) metrics(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	d, err := h.services.Operations.Dashboard(c.Request.Context(), 1)
	if err != nil {
		h.fail(c, err)
		return
	}
	var out strings.Builder
	if h.services.Metrics != nil {
		out.WriteString(h.services.Metrics.Render())
	}
	fmt.Fprintf(&out, "# TYPE lumi_sse_active gauge\nlumi_sse_active %d\n# TYPE lumi_credit_changes_total counter\nlumi_credit_changes_total %d\n", d.ActiveStreams, d.CreditChanges)
	for _, r := range d.Tasks {
		fmt.Fprintf(&out, "lumi_image_tasks{status=%q} %d\n", r.Status, r.Count)
	}
	for _, r := range d.Upstreams {
		fmt.Fprintf(&out, "lumi_upstream_calls{upstream=%q} %d\nlumi_upstream_successes{upstream=%q} %d\nlumi_upstream_latency_ms{upstream=%q} %d\n", r.UpstreamID, r.Calls, r.UpstreamID, r.Successes, r.UpstreamID, r.LatencyMs)
	}
	c.Data(200, "text/plain; version=0.0.4", []byte(out.String()))
}
func (h *Handler) resumeChat(c *gin.Context) { h.bufferedChat(c, nil) }
func (h *Handler) bufferedChat(c *gin.Context, input *chat.SendInput) {
	p, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	_, token, _ := strings.Cut(c.GetHeader("Authorization"), " ")
	verify := func(ctx context.Context) error {
		_, err := h.services.Auth.Authenticate(ctx, token, p.Actor.IP)
		return err
	}
	var request uuid.UUID
	if input != nil {
		request = input.RequestID
		if err := h.services.Chat.StartBuffered(c.Request.Context(), p.Actor, id, *input, verify); err != nil {
			h.fail(c, err)
			return
		}
	} else {
		request, err = identifier(c.Query("request_id"))
		if err != nil {
			h.fail(c, err)
			return
		}
	}
	opened := false
	emit := func(frame platformredis.ChatFrame) error {
		if !opened {
			c.Header("Content-Type", "text/event-stream; charset=utf-8")
			c.Header("Cache-Control", "no-store")
			c.Header("X-Accel-Buffering", "no")
			c.Status(200)
			opened = true
		}
		controller := http.NewResponseController(c.Writer)
		if err := controller.SetWriteDeadline(time.Now().Add(10 * time.Second)); err != nil && !errors.Is(err, http.ErrNotSupported) {
			return fmt.Errorf("set buffered stream deadline: %w", err)
		}
		if _, err := fmt.Fprintf(c.Writer, "id: %s\nevent: %s\ndata: %s\n\n", frame.ID, frame.Type, frame.Data); err != nil {
			return fmt.Errorf("write buffered chat: %w", err)
		}
		c.Writer.Flush()
		return nil
	}
	err = h.services.Chat.Buffered(c.Request.Context(), p.User.ID, id, request, c.GetHeader("Last-Event-ID"), emit, verify)
	if err != nil && !opened {
		h.fail(c, err)
	}
}
