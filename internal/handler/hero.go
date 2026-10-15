package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

type HeroHandler struct{ svc *service.HeroService }

func NewHeroHandler(svc *service.HeroService) *HeroHandler { return &HeroHandler{svc: svc} }

// Get handles GET /api/hero?native_language=. Responds for everyone who learns German while
// FEATURE_HERO_ENABLED is on — otherwise a plain 404, indistinguishable from the route not
// existing.
func (h *HeroHandler) Get(c *gin.Context) {
	native := domain.NormTranslationLang(c.Query("native_language"))
	hero, err := h.svc.Get(c.Request.Context(), userID(c), native)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, hero)
}

// StageSeen handles POST /api/hero/stage-seen — the "your hero grew up" screen was shown.
// Same 404 gating as Get.
func (h *HeroHandler) StageSeen(c *gin.Context) {
	if err := h.svc.MarkStageSeen(c.Request.Context(), userID(c)); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// IntroSeen handles POST /api/hero/intro-seen — the one-time introduction was shown. Same 404 gating.
func (h *HeroHandler) IntroSeen(c *gin.Context) {
	if err := h.svc.MarkIntroSeen(c.Request.Context(), userID(c)); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
