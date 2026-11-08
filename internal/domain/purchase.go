package domain

import (
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Pack is what a user can buy: Amount units of Feature for PriceUZS sum.
type Pack struct {
	ID       string `json:"id"`
	Feature  string `json:"feature"`
	Amount   int    `json:"amount"`
	PriceUZS int    `json:"price_uzs"`
}

// Packs is the price list, in display order.
var Packs = []Pack{
	{ID: "photo_35", Feature: FeaturePhotoImport, Amount: 35, PriceUZS: 25000},
	{ID: "photo_100", Feature: FeaturePhotoImport, Amount: 100, PriceUZS: 59000},
}

// PackByID looks a pack up in the price list.
func PackByID(id string) (Pack, bool) {
	for _, p := range Packs {
		if p.ID == id {
			return p, true
		}
	}
	return Pack{}, false
}

// Purchase request statuses. pending → paid | rejected (by an admin) | cancelled (by the user).
const (
	PurchasePending   = "pending"
	PurchasePaid      = "paid"
	PurchaseRejected  = "rejected"
	PurchaseCancelled = "cancelled"
)

// IsPurchaseStatus: one of the statuses above.
func IsPurchaseStatus(s string) bool {
	switch s {
	case PurchasePending, PurchasePaid, PurchaseRejected, PurchaseCancelled:
		return true
	}
	return false
}

// Credit ledger reasons.
const (
	CreditPurchase = "purchase" // an approved purchase request
	CreditAdmin    = "admin"    // an admin grant or correction
	CreditRefund   = "refund"   // credits taken back (money returned)
)

// PurchaseRequest is a user's request to buy a pack, paid by a manual card transfer. Code is what
// the user writes in the transfer comment so the admin can match the payment.
type PurchaseRequest struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	Code      string
	PackID    string
	Feature   string
	Amount    int
	PriceUZS  int
	Status    string
	CreatedAt time.Time
	DecidedAt *time.Time
	DecidedBy *uuid.UUID
	// UserEmail is filled in the admin listing only.
	UserEmail string
}

// PaymentInfo is where to send the money (server configuration).
type PaymentInfo struct {
	CardNumber string `json:"card_number"`
	CardHolder string `json:"card_holder"`
	Telegram   string `json:"telegram"` // username without @, for questions about a payment
}

// PurchaseOverview is the "buy photos" page: the price list, where to pay and the user's requests.
type PurchaseOverview struct {
	Packs    []Pack
	Payment  PaymentInfo
	Requests []PurchaseRequest
}

var (
	ErrPurchaseNotFound    = fmt.Errorf("purchase request %w", ErrNotFound)
	ErrTooManyPending      = errors.New("too many pending purchase requests")
	ErrPurchaseDecided     = errors.New("purchase request is already decided")
	ErrPaymentsUnavailable = errors.New("payments are not configured")
)
