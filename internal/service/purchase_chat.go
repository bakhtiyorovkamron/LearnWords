package service

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

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
// messages read (the unread badge); the buyer's reading does not (UserRead does). Also returns
// both sides' read markers.
func (s *PurchaseService) Chat(ctx context.Context, v ChatViewer, id uuid.UUID, after int64) (domain.PurchaseRequest, []domain.ChatMessage, domain.ChatReadMarkers, error) {
	if after < 0 {
		return domain.PurchaseRequest{}, nil, domain.ChatReadMarkers{}, fmt.Errorf("%w: after must not be negative", domain.ErrValidation)
	}
	p, err := s.chatRequest(ctx, v, id)
	if err != nil {
		return domain.PurchaseRequest{}, nil, domain.ChatReadMarkers{}, err
	}
	msgs, err := s.repo.Messages(ctx, id, after, domain.ChatPageSize, v.Role())
	if err != nil {
		return domain.PurchaseRequest{}, nil, domain.ChatReadMarkers{}, err
	}
	if v.Admin && len(msgs) > 0 {
		if err := s.repo.MarkAdminRead(ctx, id, msgs[len(msgs)-1].ID); err != nil {
			return domain.PurchaseRequest{}, nil, domain.ChatReadMarkers{}, err
		}
	}
	markers, err := s.repo.ChatMarkers(ctx, id)
	return p, msgs, markers, err
}

// UserRead: the buyer has read their request's chat up to upTo (404 for someone else's request).
func (s *PurchaseService) UserRead(ctx context.Context, userID, id uuid.UUID, upTo int64) error {
	if upTo < 0 {
		return fmt.Errorf("%w: up_to must not be negative", domain.ErrValidation)
	}
	if _, err := s.chatRequest(ctx, ChatViewer{UserID: userID}, id); err != nil {
		return err
	}
	return s.repo.MarkUserRead(ctx, id, userID, upTo)
}

// PostMessage adds the viewer's message (the shared chat rules: text and/or a photo; a card-like
// text is stored hidden). Not in a cancelled or rejected request (ErrChatClosed). An admin's
// visible message tells the buyer — in Telegram when linked, else by push — without its text.
// Message texts are never logged.
func (s *PurchaseService) PostMessage(ctx context.Context, v ChatViewer, id uuid.UUID, body string, image []byte) (domain.ChatMessage, error) {
	m, img, err := newChatMessage(v, body, image)
	if err != nil {
		return domain.ChatMessage{}, err
	}
	p, err := s.chatRequest(ctx, v, id)
	if err != nil {
		return domain.ChatMessage{}, err
	}
	if !domain.ChatOpen(p.Status) {
		return domain.ChatMessage{}, domain.ErrChatClosed
	}
	saved, err := s.repo.AddMessage(ctx, id, m, img)
	if err != nil {
		return domain.ChatMessage{}, err
	}
	if v.Admin && !saved.Hidden {
		s.notifier().notify(ctx, p.UserID,
			fmt.Sprintf("Новое сообщение по заявке %s. Откройте сайт, чтобы ответить.", p.Code),
			"Новое сообщение по заявке "+p.Code, "Откройте сайт, чтобы ответить.")
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

func (s *PurchaseService) notifier() chatNotifier {
	return chatNotifier{push: s.push, telegram: s.telegram, wg: &s.wg}
}
