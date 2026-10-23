package account

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/auth"
	"github.com/xinghenWink/Lumi/backend/internal/catalog"
	"github.com/xinghenWink/Lumi/backend/internal/chat"
	"github.com/xinghenWink/Lumi/backend/internal/credits"
	"github.com/xinghenWink/Lumi/backend/internal/http/middleware"
	"github.com/xinghenWink/Lumi/backend/internal/http/response"
	"github.com/xinghenWink/Lumi/backend/internal/images"
	"github.com/xinghenWink/Lumi/backend/internal/media"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/settings"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

type Services struct {
	Auth     *auth.Service
	Users    *user.Service
	Settings *settings.Service
	Audit    *audit.Service
	Gate     auth.Gate
	Credits  *credits.Service
	Catalog  *catalog.Service
	Chat     *chat.Service
	Images   *images.Service
	Files    *media.Store
}
type Security struct {
	Origins        []string
	CookieSecure   bool
	TrustedProxies []string
}
type Handler struct {
	services *Services
	security Security
	logger   *slog.Logger
}

func Routes(services *Services, security Security, logger *slog.Logger) func(*gin.Engine) error {
	return func(engine *gin.Engine) error {
		if err := engine.SetTrustedProxies(security.TrustedProxies); err != nil {
			return fmt.Errorf("configure application proxies: %w", err)
		}
		h := &Handler{services: services, security: security, logger: logger}
		api := engine.Group("/api/v1", h.available, func(c *gin.Context) { c.Header("Cache-Control", "no-store"); c.Next() })
		api.GET("/public/config", h.publicConfig)
		authRoutes := api.Group("/auth", h.csrf)
		authRoutes.POST("/register", h.register)
		authRoutes.POST("/login", h.login)
		authRoutes.POST("/send-code", h.sendCode)
		authRoutes.POST("/refresh", h.refresh)
		authRoutes.POST("/logout", h.logout)
		protected := api.Group("", h.authenticate)
		protected.GET("/me", h.me)
		protected.PATCH("/me", h.csrf, h.updateMe)
		protected.POST("/me/password", h.csrf, h.changePassword)
		admin := protected.Group("/admin", h.adminOnly)
		admin.GET("/users", h.listUsers)
		admin.POST("/users", h.csrf, h.adminLimit, h.createUser)
		admin.GET("/users/:id", h.userDetail)
		admin.PATCH("/users/:id", h.csrf, h.adminLimit, h.updateUser)
		admin.DELETE("/users/:id", h.csrf, h.adminLimit, h.deleteUser)
		admin.GET("/settings/:group", h.getSettings)
		admin.PUT("/settings/:group", h.csrf, h.adminLimit, h.saveSettings)
		admin.GET("/audit-logs", h.listAudit)
		h.creditRoutes(protected, admin)
		h.catalogRoutes(protected, admin)
		h.chatRoutes(protected, admin)
		h.imageRoutes(protected, admin)
		return nil
	}
}

func (h *Handler) available(c *gin.Context) {
	if h.services == nil {
		h.fail(c, problem.New("DEPENDENCY_UNAVAILABLE", http.StatusServiceUnavailable))
		return
	}
	c.Next()
}

func (h *Handler) csrf(c *gin.Context) {
	if c.GetHeader("X-Lumi-CSRF") != "1" {
		h.fail(c, problem.New("CSRF_REJECTED", http.StatusForbidden))
		return
	}
	origin := c.GetHeader("Origin")
	fromOrigin := origin != ""
	if origin == "" {
		origin = c.GetHeader("Referer")
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.User != nil || parsed.Scheme == "" || parsed.Host == "" {
		h.fail(c, problem.New("CSRF_REJECTED", http.StatusForbidden))
		return
	}
	if fromOrigin && (parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "") {
		h.fail(c, problem.New("CSRF_REJECTED", http.StatusForbidden))
		return
	}
	for _, allowed := range h.security.Origins {
		if strings.EqualFold(parsed.Scheme+"://"+parsed.Host, allowed) {
			c.Next()
			return
		}
	}
	h.fail(c, problem.New("CSRF_REJECTED", http.StatusForbidden))
}

func (h *Handler) authenticate(c *gin.Context) {
	scheme, encoded, ok := strings.Cut(c.GetHeader("Authorization"), " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		h.fail(c, problem.Unauthorized())
		return
	}
	principal, err := h.services.Auth.Authenticate(c.Request.Context(), encoded, client(c).IP)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.Set("principal", principal)
	c.Next()
}

func principal(c *gin.Context) (auth.Principal, bool) {
	value, exists := c.Get("principal")
	if !exists {
		return auth.Principal{}, false
	}
	result, ok := value.(auth.Principal)
	return result, ok
}
func (h *Handler) adminOnly(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	c.Next()
}
func (h *Handler) checkAdmin(c *gin.Context) bool {
	current, ok := principal(c)
	if !ok {
		h.fail(c, problem.Unauthorized())
		return false
	}
	if current.User.Role != "admin" {
		h.fail(c, problem.Forbidden())
		return false
	}
	return true
}

func (h *Handler) adminLimit(c *gin.Context) {
	current, ok := principal(c)
	if !ok {
		h.fail(c, problem.Unauthorized())
		return
	}
	allowed, retry, err := h.services.Gate.Allow(c.Request.Context(), "admin-write", current.User.ID.String(), 60, time.Minute)
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

func (h *Handler) publicConfig(c *gin.Context) {
	result, err := h.services.Settings.Public(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) register(c *gin.Context) {
	var input auth.RegisterInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Auth.Register(c.Request.Context(), input, client(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	h.setCookie(c, result)
	c.JSON(http.StatusCreated, result)
}
func (h *Handler) login(c *gin.Context) {
	var input auth.LoginInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Auth.Login(c.Request.Context(), input, client(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	h.setCookie(c, result)
	c.JSON(http.StatusOK, result)
}
func (h *Handler) sendCode(c *gin.Context) {
	var input auth.CodeInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	if err := h.services.Auth.SendCode(c.Request.Context(), input, client(c)); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"retry_after": 60})
}
func (h *Handler) refresh(c *gin.Context) {
	value, err := c.Cookie("lumi_refresh")
	if err != nil {
		h.clearCookie(c)
		h.fail(c, problem.Unauthorized())
		return
	}
	result, err := h.services.Auth.Refresh(c.Request.Context(), value, client(c))
	if err != nil {
		var rejected *problem.Error
		if errors.As(err, &rejected) && (rejected.Status == 401 || rejected.Status == 403) {
			h.clearCookie(c)
		}
		h.fail(c, err)
		return
	}
	h.setCookie(c, result)
	c.JSON(http.StatusOK, result)
}
func (h *Handler) logout(c *gin.Context) {
	value, err := c.Cookie("lumi_refresh")
	if err != nil && !errors.Is(err, http.ErrNoCookie) {
		h.fail(c, problem.Invalid())
		return
	}
	if err := h.services.Auth.Logout(c.Request.Context(), value, client(c)); err != nil {
		h.fail(c, err)
		return
	}
	h.clearCookie(c)
	c.Status(http.StatusNoContent)
}
func (h *Handler) me(c *gin.Context) {
	current, ok := principal(c)
	if !ok {
		h.fail(c, problem.Unauthorized())
		return
	}
	c.JSON(http.StatusOK, current.User)
}
func (h *Handler) updateMe(c *gin.Context) {
	current, ok := principal(c)
	if !ok {
		h.fail(c, problem.Unauthorized())
		return
	}
	var input user.SelfInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Users.UpdateSelf(c.Request.Context(), current.Actor, input)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) changePassword(c *gin.Context) {
	current, ok := principal(c)
	if !ok {
		h.fail(c, problem.Unauthorized())
		return
	}
	var input user.PasswordInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	if err := h.services.Users.ChangePassword(c.Request.Context(), current.Actor, input); err != nil {
		h.fail(c, err)
		return
	}
	h.clearCookie(c)
	c.Status(http.StatusNoContent)
}

func (h *Handler) listUsers(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	from, until, limit, err := pageArguments(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	sort := c.DefaultQuery("sort", "created_at")
	minimum, err := optionalCredits(c.Query("min_balance"))
	if err != nil {
		h.fail(c, err)
		return
	}
	maximum, err := optionalCredits(c.Query("max_balance"))
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Users.List(c.Request.Context(), user.Filter{Search: strings.TrimSpace(c.Query("search")), Role: c.Query("role"), Status: c.Query("status"), Sort: sort, Cursor: c.Query("cursor"), From: from, Until: until, Limit: limit, MinBalance: minimum, MaxBalance: maximum})
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) createUser(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	current, ok := principal(c)
	if !ok {
		h.fail(c, problem.Unauthorized())
		return
	}
	var input user.CreateInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Users.Create(c.Request.Context(), current.Actor, input)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, result)
}
func (h *Handler) userDetail(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Users.Detail(c.Request.Context(), id)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) updateUser(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	current, ok := principal(c)
	if !ok {
		h.fail(c, problem.Unauthorized())
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	var input user.UpdateInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Users.Update(c.Request.Context(), current.Actor, id, input)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) deleteUser(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	current, ok := principal(c)
	if !ok {
		h.fail(c, problem.Unauthorized())
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	var input struct {
		Email string `json:"email"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	if err := h.services.Users.Delete(c.Request.Context(), current.Actor, id, input.Email); err != nil {
		h.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
func (h *Handler) getSettings(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	if !validGroup(c.Param("group")) {
		h.fail(c, problem.Invalid())
		return
	}
	result, err := h.services.Settings.View(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) saveSettings(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	current, ok := principal(c)
	if !ok {
		h.fail(c, problem.Unauthorized())
		return
	}
	var input settings.Update
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Settings.Save(c.Request.Context(), current.Actor, c.Param("group"), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) listAudit(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	from, until, limit, err := pageArguments(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	actor, err := optionalID(c.Query("actor_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	target, err := optionalID(c.Query("target_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Audit.List(c.Request.Context(), audit.Filter{ActorID: actor, TargetID: target, Action: c.Query("action"), TargetType: c.Query("target_type"), Cursor: c.Query("cursor"), From: from, Until: until, Limit: limit})
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) setCookie(c *gin.Context, result auth.Result) {
	// #nosec G124 -- HttpOnly/Lax are fixed; Secure supports explicit local HTTP deployments.
	http.SetCookie(c.Writer, &http.Cookie{Name: "lumi_refresh", Value: result.RefreshToken, Path: "/api/v1/auth", MaxAge: 30 * 24 * 60 * 60, Expires: result.RefreshExpires, HttpOnly: true, Secure: h.security.CookieSecure, SameSite: http.SameSiteLaxMode})
}
func (h *Handler) clearCookie(c *gin.Context) {
	// #nosec G124 -- Clearing uses exactly the same configurable attributes as creation.
	http.SetCookie(c.Writer, &http.Cookie{Name: "lumi_refresh", Value: "", Path: "/api/v1/auth", MaxAge: -1, Expires: time.Unix(1, 0).UTC(), HttpOnly: true, Secure: h.security.CookieSecure, SameSite: http.SameSiteLaxMode})
}
func (h *Handler) fail(c *gin.Context, err error) {
	var rejected *problem.Error
	if errors.As(err, &rejected) {
		if rejected.RetryAfter > 0 {
			c.Header("Retry-After", strconv.Itoa(rejected.RetryAfter))
		}
		response.WriteError(c, rejected.Status, rejected.Code, http.StatusText(rejected.Status))
		return
	}
	h.logger.ErrorContext(c.Request.Context(), "account operation failed", "request_id", middleware.RequestID(c.Request.Context()), "route", c.FullPath(), "error_type", fmt.Sprintf("%T", err))
	response.WriteError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred.")
}

func decode(c *gin.Context, target any) error {
	if contentType := strings.Split(c.GetHeader("Content-Type"), ";")[0]; strings.TrimSpace(contentType) != "application/json" {
		return problem.Invalid()
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64*1024)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return problem.Invalid()
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return problem.Invalid()
	}
	return nil
}
func client(c *gin.Context) auth.Client {
	ip, err := netip.ParseAddr(c.ClientIP())
	if err != nil {
		ip = netip.MustParseAddr("0.0.0.0")
	}
	return auth.Client{IP: ip, UserAgent: c.GetHeader("User-Agent")}
}
func identifier(value string) (uuid.UUID, error) {
	id, err := uuid.Parse(value)
	if err != nil || id == uuid.Nil {
		return uuid.Nil, problem.Invalid()
	}
	return id, nil
}
func optionalID(value string) (*uuid.UUID, error) {
	if value == "" {
		return nil, nil
	}
	id, err := identifier(value)
	if err != nil {
		return nil, err
	}
	return &id, nil
}
func validGroup(value string) bool {
	return value == "site" || value == "registration" || value == "mail"
}
func pageArguments(c *gin.Context) (*time.Time, *time.Time, int32, error) {
	from, err := validation.OptionalTime(c.Query("from"))
	if err != nil {
		return nil, nil, 0, err
	}
	until, err := validation.OptionalTime(c.Query("until"))
	if err != nil {
		return nil, nil, 0, err
	}
	if from != nil && until != nil && !from.Before(*until) {
		return nil, nil, 0, problem.Invalid()
	}
	limit, err := strconv.ParseInt(c.DefaultQuery("limit", "20"), 10, 32)
	if err != nil || limit < 1 || limit > 100 {
		return nil, nil, 0, problem.Invalid()
	}
	return from, until, int32(limit), nil
}
