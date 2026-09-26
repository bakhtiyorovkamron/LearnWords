package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// DeleteCard handles DELETE /api/word-cards/:id.
func (h *ContextHandler) DeleteCard(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	if err := h.svc.DeleteCard(c.Request.Context(), userID(c), id); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
