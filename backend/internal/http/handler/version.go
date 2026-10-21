package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type Version struct {
	Version   string `json:"version"`
	Commit    string `json:"commit"`
	BuildTime string `json:"build_time"`
}

func (v Version) Get(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, v)
}
