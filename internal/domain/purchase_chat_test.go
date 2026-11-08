package domain

import "testing"

// The numbers here are made up (not real cards).
func TestLooksLikeCardNumber(t *testing.T) {
	hidden := map[string]string{
		"plain 16":           "8600123456789012",
		"in a sentence":      "моя карта 8600123456789012, спасибо",
		"spaced":             "8600 1234 5678 9012",
		"dashed":             "8600-1234-5678-9012",
		"mixed separators":   "8600 1234-5678 9012",
		"no-break spaces":    "8600 1234 5678 9012",
		"dots, 4 groups":     "8600.1234.5678.9012",
		"13 digits":          "1234567890123",
		"19 digits":          "1234567890123456789",
		"spaced 19":          "1234 5678 9012 3456 789",
		"with expiry":        "8600 1234 5678 9012 12/27",
		"4 groups then more": "8600 1234 5678 9012 3456 7890",
		"two lines":          "карта:\n8600123456789012",
	}
	for name, s := range hidden {
		if !LooksLikeCardNumber(s) {
			t.Errorf("%s (%q): want hidden", name, s)
		}
	}
	shown := map[string]string{
		"price":          "25000",
		"spaced price":   "25 000 сум",
		"code":           "Оплатил, код YD-1234",
		"phone":          "+998 90 123 45 67",
		"phone plain":    "998901234567",
		"12 digits":      "123456789012",
		"date and time":  "08.11.2026 12:30",
		"two prices":     "25000 и 59000",
		"double space":   "1234567  890123",
		"20 digits":      "12345678901234567890",
		"3 groups of 4":  "8600 1234 5678",
		"empty":          "",
		"text":           "Перевёл деньги, чек прикрепил",
		"groups of 5":    "86001 23456",
		"letters inside": "8600a1234b5678c9012",
	}
	for name, s := range shown {
		if LooksLikeCardNumber(s) {
			t.Errorf("%s (%q): want shown", name, s)
		}
	}
}

func TestPurchaseMessage_VisibleTo(t *testing.T) {
	buyerHidden := PurchaseMessage{AuthorRole: ChatAuthorBuyer, Hidden: true}
	adminHidden := PurchaseMessage{AuthorRole: ChatAuthorAdmin, Hidden: true}
	if !buyerHidden.VisibleTo(ChatAuthorBuyer) || !buyerHidden.VisibleTo(ChatAuthorAdmin) {
		t.Error("the buyer's hidden message: the buyer and the admins see it")
	}
	if adminHidden.VisibleTo(ChatAuthorBuyer) || !adminHidden.VisibleTo(ChatAuthorAdmin) {
		t.Error("an admin's hidden message: only admins see it")
	}
	if !(PurchaseMessage{AuthorRole: ChatAuthorAdmin}).VisibleTo(ChatAuthorBuyer) {
		t.Error("a normal message is seen by both sides")
	}
}

func TestChatOpen(t *testing.T) {
	for status, open := range map[string]bool{PurchasePending: true, PurchasePaid: true, PurchaseCancelled: false, PurchaseRejected: false} {
		if ChatOpen(status) != open {
			t.Errorf("%s: open=%v", status, !open)
		}
	}
}
