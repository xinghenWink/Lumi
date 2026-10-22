package account

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/catalog"
	"net/http"
)

func (h *Handler) catalogRoutes(protected, admin *gin.RouterGroup) {
	protected.GET("/models", h.publicModels)
	admin.GET("/upstreams", h.listUpstreams)
	admin.POST("/upstreams", h.csrf, h.adminLimit, h.saveUpstream)
	admin.PUT("/upstreams/:id", h.csrf, h.adminLimit, h.saveUpstream)
	admin.DELETE("/upstreams/:id", h.csrf, h.adminLimit, h.deleteUpstream)
	admin.POST("/upstreams/:id/test", h.csrf, h.adminLimit, h.testUpstream)
	admin.POST("/upstreams/:id/discover", h.csrf, h.adminLimit, h.discoverModels)
	admin.POST("/upstreams/:id/import", h.csrf, h.adminLimit, h.importModels)
	admin.GET("/models", h.listModels)
	admin.POST("/models", h.csrf, h.adminLimit, h.saveModel)
	admin.PUT("/models/:id", h.csrf, h.adminLimit, h.saveModel)
	admin.DELETE("/models/:id", h.csrf, h.adminLimit, h.deleteModel)
}
func (h *Handler) publicModels(c *gin.Context) {
	result, err := h.services.Catalog.Public(c.Request.Context(), c.Query("type"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": result})
}
func catalogFilter(c *gin.Context) (catalog.Filter, error) {
	_, _, limit, err := pageArguments(c)
	return catalog.Filter{Search: c.Query("search"), State: c.Query("state"), Kind: c.Query("type"), Cursor: c.Query("cursor"), Limit: limit}, err
}
func (h *Handler) listUpstreams(c *gin.Context) {
	filter, err := catalogFilter(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Catalog.Channels(c.Request.Context(), filter)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) listModels(c *gin.Context) {
	filter, err := catalogFilter(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Catalog.Models(c.Request.Context(), filter)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) saveUpstream(c *gin.Context) {
	current, ok := principal(c)
	if !ok {
		return
	}
	id := uuid.Nil
	if c.Param("id") != "" {
		var err error
		id, err = identifier(c.Param("id"))
		if err != nil {
			h.fail(c, err)
			return
		}
	}
	var input catalog.ChannelInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Catalog.SaveChannel(c.Request.Context(), current.Actor, id, input)
	if err != nil {
		h.fail(c, err)
		return
	}
	status := http.StatusOK
	if id == uuid.Nil {
		status = http.StatusCreated
	}
	c.JSON(status, result)
}
func (h *Handler) deleteUpstream(c *gin.Context) {
	current, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	if err := h.services.Catalog.DeleteChannel(c.Request.Context(), current.Actor, id); err != nil {
		h.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
func (h *Handler) testUpstream(c *gin.Context) {
	current, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Catalog.Test(c.Request.Context(), current.Actor, id)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) discoverModels(c *gin.Context) {
	current, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Catalog.Discover(c.Request.Context(), current.Actor, id)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) importModels(c *gin.Context) {
	current, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	var input catalog.ImportInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Catalog.Import(c.Request.Context(), current.Actor, id, input)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": result})
}
func (h *Handler) saveModel(c *gin.Context) {
	current, ok := principal(c)
	if !ok {
		return
	}
	id := uuid.Nil
	if c.Param("id") != "" {
		var err error
		id, err = identifier(c.Param("id"))
		if err != nil {
			h.fail(c, err)
			return
		}
	}
	var input catalog.ModelInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Catalog.SaveModel(c.Request.Context(), current.Actor, id, input)
	if err != nil {
		h.fail(c, err)
		return
	}
	status := http.StatusOK
	if id == uuid.Nil {
		status = http.StatusCreated
	}
	c.JSON(status, result)
}
func (h *Handler) deleteModel(c *gin.Context) {
	current, ok := principal(c)
	if !ok {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	if err := h.services.Catalog.DeleteModel(c.Request.Context(), current.Actor, id); err != nil {
		h.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
