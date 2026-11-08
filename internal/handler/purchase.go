package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

// PurchaseHandler: buying photo credits by a manual card transfer (the user's side and the admin's).
type PurchaseHandler struct{ svc *service.PurchaseService }

func NewPurchaseHandler(svc *service.PurchaseService) *PurchaseHandler {
	return &PurchaseHandler{svc: svc}
}

// purchaseView is a request as its owner sees it.
type purchaseView struct {
	ID        uuid.UUID  `json:"id"`
	Code      string     `json:"code"`
	PackID    string     `json:"pack_id"`
	Feature   string     `json:"feature"`
	Amount    int        `json:"amount"`
	PriceUZS  int        `json:"price_uzs"`
	Status    string     `json:"status"`
	CreatedAt time.Time  `json:"created_at"`
	DecidedAt *time.Time `json:"decided_at"`
}

func newPurchaseView(p domain.PurchaseRequest) purchaseView {
	return purchaseView{ID: p.ID, Code: p.Code, PackID: p.PackID, Feature: p.Feature, Amount: p.Amount,
		PriceUZS: p.PriceUZS, Status: p.Status, CreatedAt: p.CreatedAt, DecidedAt: p.DecidedAt}
}

// adminPurchaseView adds whose request it is and who decided it.
type adminPurchaseView struct {
	purchaseView
	UserID    uuid.UUID  `json:"user_id"`
	UserEmail string     `json:"user_email"`
	DecidedBy *uuid.UUID `json:"decided_by"`
}

func newAdminPurchaseView(p domain.PurchaseRequest) adminPurchaseView {
	return adminPurchaseView{purchaseView: newPurchaseView(p), UserID: p.UserID, UserEmail: p.UserEmail, DecidedBy: p.DecidedBy}
}

func mapSlice[T, V any](in []T, f func(T) V) []V {
	out := make([]V, 0, len(in))
	for _, x := range in {
		out = append(out, f(x))
	}
	return out
}

// Overview handles GET /api/me/purchases → {packs: [{id, feature, amount, price_uzs}],
// payment: {card_number, card_holder, telegram}, requests: [the caller's 10 latest, newest first]}.
// 503 payments_unavailable when no card is configured.
func (h *PurchaseHandler) Overview(c *gin.Context) {
	o, err := h.svc.Overview(c.Request.Context(), userID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"packs": o.Packs, "payment": o.Payment, "requests": mapSlice(o.Requests, newPurchaseView)})
}

// Create handles POST /api/me/purchases {pack_id} → 201 the new pending request. 400 unknown pack,
// 409 too_many_pending (3 are waiting already), 503 payments_unavailable.
func (h *PurchaseHandler) Create(c *gin.Context) {
	var req struct {
		PackID string `json:"pack_id"`
	}
	if !bindSmallJSON(c, &req) {
		return
	}
	p, err := h.svc.Create(c.Request.Context(), userID(c), req.PackID)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, newPurchaseView(p))
}

// Cancel handles DELETE /api/me/purchases/:id → 204. Only the caller's own pending request; anything
// else is 404.
func (h *PurchaseHandler) Cancel(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	if err := h.svc.Cancel(c.Request.Context(), userID(c), id); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// AdminList handles GET /api/admin/purchases?status=pending|paid|rejected|cancelled|all (default
// pending) → {requests: [...]}, newest first.
func (h *PurchaseHandler) AdminList(c *gin.Context) {
	reqs, err := h.svc.List(c.Request.Context(), c.Query("status"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"requests": mapSlice(reqs, newAdminPurchaseView)})
}

// Approve handles POST /api/admin/purchases/:id/approve → the paid request; its credits are added
// and the user gets a push. 409 already_decided (the credits are not added again).
func (h *PurchaseHandler) Approve(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	p, err := h.svc.Approve(c.Request.Context(), userID(c), id)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, newAdminPurchaseView(p))
}

// Reject handles POST /api/admin/purchases/:id/reject → the rejected request. 409 already_decided.
func (h *PurchaseHandler) Reject(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	p, err := h.svc.Reject(c.Request.Context(), userID(c), id)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, newAdminPurchaseView(p))
}

// Grant handles POST /api/admin/users/:id/credits {feature, amount, note} → {balance}. amount is
// added to the user's purchased balance (negative takes away; never below 0 → 400).
func (h *PurchaseHandler) Grant(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	var req struct {
		Feature string `json:"feature"`
		Amount  *int   `json:"amount"`
		Note    string `json:"note"`
	}
	if !bindSmallJSON(c, &req) {
		return
	}
	if req.Amount == nil {
		badRequest(c, `body must be {"feature": string, "amount": non-zero number, "note": string}`)
		return
	}
	balance, err := h.svc.Grant(c.Request.Context(), userID(c), id, req.Feature, *req.Amount, req.Note)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"balance": balance})
}
