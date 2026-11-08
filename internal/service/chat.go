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
	"sync"
	"unicode/utf8"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// The rules every chat with the admins shares (support and purchase threads).

// ChatViewer is who reads or writes a chat: the user (their own threads only) or an admin.
type ChatViewer struct {
	UserID uuid.UUID
	Admin  bool
}

// Role is the viewer's side of the chat (user or admin).
func (v ChatViewer) Role() string {
	if v.Admin {
		return domain.ChatAuthorAdmin
	}
	return domain.ChatAuthorUser
}

// TelegramNotifier writes to a user's linked Telegram chat (TelegramService); sent = false when
// the user has none (or there is no bot).
type TelegramNotifier interface {
	NotifyUser(ctx context.Context, userID uuid.UUID, text string) (sent bool, err error)
}

// newChatMessage checks and builds the viewer's message: text (trimmed, at most MaxChatBody
// characters) and/or a photo (JPEG, PNG, WebP or GIF up to MaxPhotoBytes, under a random key).
// Text that looks like a card number makes the message hidden (reason card_number).
func newChatMessage(v ChatViewer, body string, image []byte) (domain.ChatMessage, *domain.ChatImage, error) {
	body = strings.TrimSpace(body)
	if body == "" && len(image) == 0 {
		return domain.ChatMessage{}, nil, fmt.Errorf("%w: a message needs text or a photo", domain.ErrValidation)
	}
	if utf8.RuneCountInString(body) > domain.MaxChatBody {
		return domain.ChatMessage{}, nil, fmt.Errorf("%w: a message is at most %d characters", domain.ErrValidation, domain.MaxChatBody)
	}
	if len(image) > MaxPhotoBytes {
		return domain.ChatMessage{}, nil, fmt.Errorf("%w: a photo is at most %d MB", domain.ErrValidation, MaxPhotoBytes>>20)
	}
	m := domain.ChatMessage{AuthorRole: v.Role(), AuthorUserID: &v.UserID}
	if body != "" {
		m.Body = &body
		if domain.LooksLikeCardNumber(body) {
			reason := domain.HiddenCardNumber
			m.Hidden, m.HiddenReason = true, &reason
		}
	}
	if len(image) == 0 {
		return m, nil, nil
	}
	ct := http.DetectContentType(image)
	if !photoTypes[ct] {
		return domain.ChatMessage{}, nil, fmt.Errorf("%w: a photo must be JPEG, PNG, WebP or GIF", domain.ErrValidation)
	}
	key, err := newImageKey()
	if err != nil {
		return domain.ChatMessage{}, nil, err
	}
	m.ImageKey = &key
	return m, &domain.ChatImage{Key: key, ContentType: ct, Data: image}, nil
}

// newImageKey: 16 random bytes, hex — not guessable, not derived from the photo.
func newImageKey() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "pm_" + hex.EncodeToString(b), nil
}

// chatNotifier tells a user an admin wrote: in Telegram when linked, else (also when Telegram
// fails) by push. Neither carries the message text. It runs in the background (wg) and only logs.
type chatNotifier struct {
	push     Notifier
	telegram TelegramNotifier
	wg       *sync.WaitGroup
}

func (n chatNotifier) notify(ctx context.Context, userID uuid.UUID, telegramText, pushTitle, pushBody string) {
	tg, push := n.telegram, n.push
	if tg == nil && (push == nil || !push.Enabled()) {
		return
	}
	n.wg.Add(1)
	go func() {
		defer n.wg.Done()
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), purchaseNotifyTimeout)
		defer cancel()
		if tg != nil {
			sent, err := tg.NotifyUser(ctx, userID, telegramText)
			if err != nil {
				slog.WarnContext(ctx, "chat: telegram notification failed", "user", userID, "err", err)
			}
			if sent {
				return
			}
		}
		if push == nil || !push.Enabled() {
			return
		}
		if _, err := push.SendTo(ctx, PushTarget{UserIDs: []uuid.UUID{userID}}, pushTitle, pushBody); err != nil && !errors.Is(err, domain.ErrPushDisabled) {
			slog.ErrorContext(ctx, "chat: push failed", "user", userID, "err", err)
		}
	}()
}
