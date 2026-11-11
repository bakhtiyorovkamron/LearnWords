package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

// TelegramRulesHandler: the automatic Telegram notifications an admin edits.
type TelegramRulesHandler struct{ svc *service.TelegramRulesService }

func NewTelegramRulesHandler(svc *service.TelegramRulesService) *TelegramRulesHandler {
	return &TelegramRulesHandler{svc: svc}
}

// List handles GET /api/admin/telegram/rules → [{key, enabled, send_at, text: {ru, uz, en}, button,
// placeholders, last_run_on, last_sent}].
func (h *TelegramRulesHandler) List(c *gin.Context) {
	rules, err := h.svc.Rules(c.Request.Context())
	if err != nil {
		writeError(c, err)
		return
	}
	if rules == nil {
		rules = []domain.TelegramRule{}
	}
	c.JSON(http.StatusOK, rules)
}

// Update handles PUT /api/admin/telegram/rules/:key {enabled, send_at, text: {ru, uz, en}, button} →
// the rule. 400 with {code, field}: invalid_placeholder, invalid_send_at (also the quiet hours
// 22:00–08:00), invalid_text, invalid_button. 404 for an unknown key.
func (h *TelegramRulesHandler) Update(c *gin.Context) {
	var req struct {
		Enabled bool    `json:"enabled"`
		SendAt  *string `json:"send_at"`
		Text    struct {
			RU string `json:"ru"`
			UZ string `json:"uz"`
			EN string `json:"en"`
		} `json:"text"`
		Button *domain.TelegramButton `json:"button"`
	}
	if !bindSmallJSON(c, &req) {
		return
	}
	rule, err := h.svc.Update(c.Request.Context(), c.Param("key"), req.Enabled, req.SendAt, req.Text.RU, req.Text.UZ, req.Text.EN, req.Button)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, rule)
}

// Preview handles GET /api/admin/telegram/rules/:key/preview → {recipients}: who would get a daily
// rule if it ran now.
func (h *TelegramRulesHandler) Preview(c *gin.Context) {
	n, err := h.svc.Preview(c.Request.Context(), c.Param("key"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"recipients": n})
}

// Test handles POST /api/admin/telegram/rules/:key/test → 204: the rendered text with sample values
// goes to the calling admin. 400 telegram_not_linked, 503 telegram_unavailable.
func (h *TelegramRulesHandler) Test(c *gin.Context) {
	if err := h.svc.Test(c.Request.Context(), userID(c), c.Param("key")); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
