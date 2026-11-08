package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// ChatViewer is who reads or writes a purchase chat: the buyer (their own requests only) or an admin.
type ChatViewer struct {
	UserID uuid.UUID
	Admin  bool
}

// Role is the viewer's side of the chat (buyer or admin).
func (v ChatViewer) Role() string {
	if v.Admin {
		return domain.ChatAuthorAdmin
	}
	return domain.ChatAuthorBuyer
}

// TelegramNotifier writes to a user's linked Telegram chat (TelegramService); sent = false when
// the user has none (or there is no bot).
type TelegramNotifier interface {
	NotifyUser(ctx context.Context, userID uuid.UUID, text string) (sent bool, err error)
}

// chatRequest loads a request the viewer may open: any for an admin, the buyer's own otherwise
// (someone else's is ErrPurchaseNotFound, as if it did not exist).
func (s *PurchaseService) chatRequest(ctx context.Context, v ChatViewer, id uuid.UUID) (domain.PurchaseRequest, error) {
	p, err := s.repo.Get(ctx, id)
	if err != nil {
		return domain.PurchaseRequest{}, err
	}
	if !v.Admin && p.UserID != v.UserID {
		return domain.PurchaseRequest{}, domain.ErrPurchaseNotFound
	}
	return p, nil
}

// Chat returns the request and up to ChatPageSize of its messages after `after` that the viewer may
// see (oldest first). The history is readable in every status. An admin reading marks the
// messages read (the unread badge).
func (s *PurchaseService) Chat(ctx context.Context, v ChatViewer, id uuid.UUID, after int64) (domain.PurchaseRequest, []domain.PurchaseMessage, error) {
	if after < 0 {
		return domain.PurchaseRequest{}, nil, fmt.Errorf("%w: after must not be negative", domain.ErrValidation)
	}
	p, err := s.chatRequest(ctx, v, id)
	if err != nil {
		return domain.PurchaseRequest{}, nil, err
	}
	msgs, err := s.repo.Messages(ctx, id, after, domain.ChatPageSize, v.Role())
	if err != nil {
		return domain.PurchaseRequest{}, nil, err
	}
	if v.Admin && len(msgs) > 0 {
		if err := s.repo.MarkAdminRead(ctx, id, msgs[len(msgs)-1].ID); err != nil {
			return domain.PurchaseRequest{}, nil, err
		}
	}
	return p, msgs, nil
}

// PostMessage adds the viewer's message: text (trimmed, at most MaxChatBody characters) and/or a
// photo (JPEG, PNG, WebP or GIF up to MaxPhotoBytes, stored under a random key). Not in a cancelled
// or rejected request (ErrChatClosed). Text that looks like a card number is stored hidden: the
// other side never sees it. An admin's visible message tells the buyer — in Telegram when linked,
// else by push — without its text. Message texts are never logged.
func (s *PurchaseService) PostMessage(ctx context.Context, v ChatViewer, id uuid.UUID, body string, image []byte) (domain.PurchaseMessage, error) {
	body = strings.TrimSpace(body)
	if body == "" && len(image) == 0 {
		return domain.PurchaseMessage{}, fmt.Errorf("%w: a message needs text or a photo", domain.ErrValidation)
	}
	if utf8.RuneCountInString(body) > domain.MaxChatBody {
		return domain.PurchaseMessage{}, fmt.Errorf("%w: a message is at most %d characters", domain.ErrValidation, domain.MaxChatBody)
	}
	if len(image) > MaxPhotoBytes {
		return domain.PurchaseMessage{}, fmt.Errorf("%w: a photo is at most %d MB", domain.ErrValidation, MaxPhotoBytes>>20)
	}
	p, err := s.chatRequest(ctx, v, id)
	if err != nil {
		return domain.PurchaseMessage{}, err
	}
	if !domain.ChatOpen(p.Status) {
		return domain.PurchaseMessage{}, domain.ErrChatClosed
	}
	m := domain.PurchaseMessage{RequestID: id, AuthorRole: v.Role(), AuthorUserID: &v.UserID}
	if body != "" {
		m.Body = &body
		if domain.LooksLikeCardNumber(body) {
			reason := domain.HiddenCardNumber
			m.Hidden, m.HiddenReason = true, &reason
		}
	}
	var img *domain.ChatImage
	if len(image) > 0 {
		ct := http.DetectContentType(image)
		if !photoTypes[ct] {
			return domain.PurchaseMessage{}, fmt.Errorf("%w: a photo must be JPEG, PNG, WebP or GIF", domain.ErrValidation)
		}
		key, err := newImageKey()
		if err != nil {
			return domain.PurchaseMessage{}, err
		}
		img = &domain.ChatImage{Key: key, ContentType: ct, Data: image}
		m.ImageKey = &img.Key
	}
	saved, err := s.repo.AddMessage(ctx, m, img)
	if err != nil {
		return domain.PurchaseMessage{}, err
	}
	if v.Admin && !saved.Hidden {
		s.notifyBuyer(ctx, p)
	}
	return saved, nil
}

// MessageImage returns a message's photo when the viewer may see the message (else ErrNotFound).
// The buyer's side does not get photos of hidden messages back either.
func (s *PurchaseService) MessageImage(ctx context.Context, v ChatViewer, id uuid.UUID, messageID int64) (domain.ChatImage, error) {
	if _, err := s.chatRequest(ctx, v, id); err != nil {
		return domain.ChatImage{}, err
	}
	m, img, err := s.repo.MessageImage(ctx, id, messageID)
	if err != nil {
		return domain.ChatImage{}, err
	}
	if m.Hidden && !v.Admin {
		return domain.ChatImage{}, domain.ErrNotFound
	}
	return img, nil
}

// notifyBuyer tells the buyer an admin wrote, in the background (errors are logged, the request
// does not wait): in Telegram when linked, else (also when Telegram fails) by push. Neither carries
// the message text.
func (s *PurchaseService) notifyBuyer(ctx context.Context, p domain.PurchaseRequest) {
	tg, push := s.telegram, s.push
	if tg == nil && (push == nil || !push.Enabled()) {
		return
	}
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), purchaseNotifyTimeout)
		defer cancel()
		if tg != nil {
			sent, err := tg.NotifyUser(ctx, p.UserID, fmt.Sprintf("Новое сообщение по заявке %s. Откройте сайт, чтобы ответить.", p.Code))
			if err != nil {
				slog.WarnContext(ctx, "purchase chat: telegram notification failed", "request", p.ID, "err", err)
			}
			if sent {
				return
			}
		}
		if push == nil || !push.Enabled() {
			return
		}
		_, err := push.SendTo(ctx, PushTarget{UserIDs: []uuid.UUID{p.UserID}}, "Новое сообщение по заявке "+p.Code, "Откройте сайт, чтобы ответить.")
		if err != nil && !errors.Is(err, domain.ErrPushDisabled) {
			slog.ErrorContext(ctx, "purchase chat: push failed", "request", p.ID, "err", err)
		}
	}()
}

// newImageKey: 16 random bytes, hex — not guessable, not derived from the photo.
func newImageKey() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "pm_" + hex.EncodeToString(b), nil
}
