package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"learnwords/internal/service"
)

type StatsHandler struct{ svc *service.StatsService }

func NewStatsHandler(svc *service.StatsService) *StatsHandler { return &StatsHandler{svc: svc} }

// Get handles GET /api/stats?period=week|month.
func (h *StatsHandler) Get(c *gin.Context) {
	stats, err := h.svc.Get(c.Request.Context(), userID(c), c.DefaultQuery("period", "week"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, stats)
}
