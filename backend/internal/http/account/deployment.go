package account

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/deployment"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
)

func (h *Handler) deploymentRoutes(admin *gin.RouterGroup) {
	admin.GET("/system/releases", h.releases)
	admin.POST("/system/deployment-jobs", h.csrf, h.adminLimit, h.enqueueDeployment)
	admin.GET("/system/deployment-jobs/:id", h.deploymentJob)
}

func (h *Handler) releases(c *gin.Context) {
	if h.services.Deployment == nil {
		h.fail(c, problem.New("DEPENDENCY_UNAVAILABLE", http.StatusServiceUnavailable))
		return
	}
	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	refresh := c.Query("refresh")
	if err != nil || refresh != "" && refresh != "1" {
		h.fail(c, problem.Invalid())
		return
	}
	result, err := h.services.Deployment.Releases(c.Request.Context(), page, refresh == "1")
	h.imageReply(c, result, err, http.StatusOK)
}

func (h *Handler) enqueueDeployment(c *gin.Context) {
	if h.services.Deployment == nil {
		h.fail(c, problem.New("DEPENDENCY_UNAVAILABLE", http.StatusServiceUnavailable))
		return
	}
	p, _ := principal(c)
	key, err := uuid.Parse(c.GetHeader("Idempotency-Key"))
	if err != nil {
		h.fail(c, problem.Invalid())
		return
	}
	var input deployment.Request
	if err := decodeLimit(c, &input, 4096); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Deployment.Enqueue(c.Request.Context(), p.Actor, key, input)
	h.imageReply(c, result, err, http.StatusAccepted)
}

func (h *Handler) deploymentJob(c *gin.Context) {
	if h.services.Deployment == nil {
		h.fail(c, problem.New("DEPENDENCY_UNAVAILABLE", http.StatusServiceUnavailable))
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Deployment.Job(c.Request.Context(), id)
	h.imageReply(c, result, err, http.StatusOK)
}
