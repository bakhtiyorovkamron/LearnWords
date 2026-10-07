package handler

import (
	"context"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
)

type FolderStore interface {
	List(ctx context.Context, userID uuid.UUID) ([]domain.Folder, error)
	Create(ctx context.Context, userID uuid.UUID, name, color string) (*domain.Folder, error)
	Update(ctx context.Context, userID, id uuid.UUID, name, color *string) (*domain.Folder, error)
	Delete(ctx context.Context, userID, id uuid.UUID) error
}

type FolderHandler struct{ store FolderStore }

func NewFolderHandler(store FolderStore) *FolderHandler { return &FolderHandler{store: store} }

const maxFolders = 100

// Colour is a short token (e.g. "amber") or a #hex value — never arbitrary CSS.
var folderColorRe = regexp.MustCompile(`^(#[0-9a-fA-F]{3,8}|[a-z]{1,15})?$`)

type folderReq struct {
	Name  *string `json:"name"`
	Color *string `json:"color"`
}

func (r *folderReq) validate(requireName bool) string {
	if r.Name != nil {
		n := strings.TrimSpace(*r.Name)
		r.Name = &n
		if n == "" || len([]rune(n)) > 50 {
			return "name must be 1-50 characters"
		}
	} else if requireName {
		return "name is required"
	}
	if r.Color != nil {
		c := strings.TrimSpace(*r.Color)
		r.Color = &c
		if !folderColorRe.MatchString(c) {
			return "invalid color"
		}
	}
	return ""
}

// List handles GET /api/folders.
func (h *FolderHandler) List(c *gin.Context) {
	items, err := h.store.List(c.Request.Context(), userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"folders": items})
}

// Create handles POST /api/folders {"name","color"}.
func (h *FolderHandler) Create(c *gin.Context) {
	var req folderReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "invalid JSON body")
		return
	}
	if msg := req.validate(true); msg != "" {
		badRequest(c, msg)
		return
	}
	existing, err := h.store.List(c.Request.Context(), userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	if len(existing) >= maxFolders {
		badRequest(c, "too many folders")
		return
	}
	color := ""
	if req.Color != nil {
		color = *req.Color
	}
	f, err := h.store.Create(c.Request.Context(), userID(c), *req.Name, color)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, f)
}

// Update handles PATCH /api/folders/:id {"name"?, "color"?}.
func (h *FolderHandler) Update(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	var req folderReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "invalid JSON body")
		return
	}
	if msg := req.validate(false); msg != "" {
		badRequest(c, msg)
		return
	}
	if req.Name == nil && req.Color == nil {
		badRequest(c, "nothing to update")
		return
	}
	f, err := h.store.Update(c.Request.Context(), userID(c), id, req.Name, req.Color)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, f)
}

// Delete handles DELETE /api/folders/:id. Words in the folder are kept (become folder-less).
func (h *FolderHandler) Delete(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	if err := h.store.Delete(c.Request.Context(), userID(c), id); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// parseFolderFilter reads ?folder_id=: "" → nil (all words), "none" → words without a folder,
// otherwise a folder UUID. Ownership is guaranteed because every query also filters by user_id.
func parseFolderFilter(c *gin.Context) (*domain.FolderFilter, bool) {
	v := strings.TrimSpace(c.Query("folder_id"))
	switch v {
	case "", "all":
		return nil, true
	case "none":
		return &domain.FolderFilter{None: true}, true
	}
	id, err := uuid.Parse(v)
	if err != nil {
		badRequest(c, "invalid folder_id")
		return nil, false
	}
	return &domain.FolderFilter{ID: id}, true
}
