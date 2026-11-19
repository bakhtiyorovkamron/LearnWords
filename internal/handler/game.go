package handler

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

// GamePlayer keeps the folder games' records (service.GameService).
type GamePlayer interface {
	Records(ctx context.Context, userID uuid.UUID, folder *domain.FolderFilter) ([]domain.GameRecord, error)
	SaveResult(ctx context.Context, userID uuid.UUID, folder *domain.FolderFilter, game string, score int, of *int) (service.GameResult, error)
}

// GameHandler serves the folder games (behind FeatureFolderGames, off by default).
type GameHandler struct {
	svc      GamePlayer
	features FeatureGate
}

func NewGameHandler(svc GamePlayer, features FeatureGate) *GameHandler {
	return &GameHandler{svc: svc, features: features}
}

// require writes 403 feature_disabled and returns false when folder games are off for the caller.
func (h *GameHandler) require(c *gin.Context) bool {
	if err := h.features.Require(c.Request.Context(), userID(c), domain.FeatureFolderGames); err != nil {
		writeError(c, err)
		return false
	}
	return true
}

// Records handles GET /api/games/records?folder_id=<uuid|none|all> → {"records": [...]}: the
// caller's best result of each game played in that folder. Another user's folder → 404.
func (h *GameHandler) Records(c *gin.Context) {
	if !h.require(c) {
		return
	}
	folder, ok := parseFolderFilter(c)
	if !ok {
		return
	}
	records, err := h.svc.Records(c.Request.Context(), userID(c), folder)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"records": records})
}

// Result handles POST /api/games/result {"game", "folder_id": "<uuid|none|all>", "score", "of"}
// → {"record": {...}, "new_record": bool, "previous": int|null}. Pairs: score = ms with the
// penalties, no of; articles: score right on the first try, of = the nouns played.
func (h *GameHandler) Result(c *gin.Context) {
	if !h.require(c) {
		return
	}
	var req struct {
		Game     string `json:"game"`
		FolderID string `json:"folder_id"`
		Score    *int   `json:"score"`
		Of       *int   `json:"of"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "invalid JSON body")
		return
	}
	if req.Game == "" || req.Score == nil {
		badRequest(c, "game and score are required")
		return
	}
	folder, err := parseGameFolder(req.FolderID)
	if err != nil {
		badRequest(c, "invalid folder_id")
		return
	}
	res, err := h.svc.SaveResult(c.Request.Context(), userID(c), folder, req.Game, *req.Score, req.Of)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// parseGameFolder reads a body's folder_id the way parseFolderFilter reads the query: "" or
// "all" → nil (all words), "none" → words without a folder, otherwise a folder UUID.
func parseGameFolder(v string) (*domain.FolderFilter, error) {
	switch v {
	case "", "all":
		return nil, nil
	case "none":
		return &domain.FolderFilter{None: true}, nil
	}
	id, err := uuid.Parse(v)
	if err != nil {
		return nil, err
	}
	return &domain.FolderFilter{ID: id}, nil
}
