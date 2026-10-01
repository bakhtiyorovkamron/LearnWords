package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// DeleteContext handles DELETE /api/contexts/:id.
func (h *ContextHandler) DeleteContext(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	if err := h.svc.DeleteContext(c.Request.Context(), userID(c), id); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
