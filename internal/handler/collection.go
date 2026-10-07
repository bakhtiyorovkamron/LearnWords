package handler

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
)

type CollectionStore interface {
	ListCollection(ctx context.Context, userID uuid.UUID, f domain.CollectionFilter) ([]domain.CollectionCard, int, error)
}

type CollectionHandler struct{ store CollectionStore }

func NewCollectionHandler(store CollectionStore) *CollectionHandler {
	return &CollectionHandler{store: store}
}

var (
	collectionStatuses = map[string]bool{"": true, "all": true, "new": true, "learning": true, "learned": true}
	collectionPeriods  = map[string]bool{"": true, "all": true, "today": true, "week": true}
	collectionSorts    = map[string]bool{"": true, "date": true, "alpha": true, "progress": true}
)

// List handles GET /api/collection?status=&period=&sort=&q=&limit=&offset=
func (h *CollectionHandler) List(c *gin.Context) {
	f := domain.CollectionFilter{
		Status: c.Query("status"),
		Period: c.Query("period"),
		Sort:   c.Query("sort"),
		Q:      c.Query("q"),
	}
	folder, ok := parseFolderFilter(c)
	if !ok {
		return
	}
	f.Folder = folder
	if !collectionStatuses[f.Status] || !collectionPeriods[f.Period] || !collectionSorts[f.Sort] {
		badRequest(c, "invalid status, period or sort")
		return
	}
	if len([]rune(f.Q)) > 100 {
		badRequest(c, "search query too long")
		return
	}
	f.Limit, f.Offset = pagination(c)
	items, total, err := h.store.ListCollection(c.Request.Context(), userID(c), f)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "limit": f.Limit, "offset": f.Offset})
}
