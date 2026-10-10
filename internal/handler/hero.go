package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

type HeroHandler struct{ svc *service.HeroService }

func NewHeroHandler(svc *service.HeroService) *HeroHandler { return &HeroHandler{svc: svc} }

// Get handles GET /api/hero?native_language=. Only ever responds for users on the
// FEATURE_HERO_EMAILS allowlist who are learning German — everyone else gets a plain 404,
// indistinguishable from the route not existing at all.
func (h *HeroHandler) Get(c *gin.Context) {
	native := domain.NormTranslationLang(c.Query("native_language"))
	hero, err := h.svc.Get(c.Request.Context(), userID(c), native)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, hero)
}
