package service

import (
	"context"
	"fmt"
	"sync"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// supportThreadListLimit: support threads in one admin listing.
const supportThreadListLimit = 200

// SupportRepository stores the users' support threads (the shared chat tables).
type SupportRepository interface {
	// EnsureThread returns the user's thread, creating it on first use (one per user).
	EnsureThread(ctx context.Context, userID uuid.UUID) (domain.ChatThread, error)
	// Thread: a support thread with the user's email and unread count; ErrNotFound when missing.
	Thread(ctx context.Context, id int64) (domain.ChatThread, error)
	// Threads: the threads with messages, newest conversation first, with the unread count and
	// the last message; unreadOnly keeps those with unread messages.
	Threads(ctx context.Context, unreadOnly bool, limit int) ([]domain.ChatThread, error)
	AddMessage(ctx context.Context, threadID int64, m domain.ChatMessage, img *domain.ChatImage) (domain.ChatMessage, error)
	// Messages: up to limit after `after`, oldest first, those viewerRole may see.
	Messages(ctx context.Context, threadID, after int64, limit int, viewerRole string) ([]domain.ChatMessage, error)
	// MarkRead marks the thread read for the admins up to upTo (0 = its newest message).
	MarkRead(ctx context.Context, threadID, upTo int64) error
	// MarkUserRead marks the user's own thread read for them up to upTo (never backwards); ErrNotFound
	// when the thread is not theirs.
	MarkUserRead(ctx context.Context, userID uuid.UUID, threadID, upTo int64) error
	MessageImage(ctx context.Context, threadID, messageID int64) (domain.ChatMessage, domain.ChatImage, error)
}

// SupportService is every user's own conversation with the admin team, open without any purchase:
// text and photos, the same card-number guard as the order chat. The user only ever reaches their
// own thread (created on first use); the admins see every thread.
type SupportService struct {
	repo     SupportRepository
	push     Notifier         // nil = no push
	telegram TelegramNotifier // nil = push only
	wg       sync.WaitGroup   // notifications in flight
}

func NewSupportService(repo SupportRepository, push Notifier, telegram TelegramNotifier) *SupportService {
	return &SupportService{repo: repo, push: push, telegram: telegram}
}

func validAfter(after int64) error {
	if after < 0 {
		return fmt.Errorf("%w: after must not be negative", domain.ErrValidation)
	}
	return nil
}

// UserMessages: the user's thread and up to ChatPageSize of its messages after `after` (their own
// hidden ones included, as the warning; the admins' hidden ones never).
func (s *SupportService) UserMessages(ctx context.Context, userID uuid.UUID, after int64) (domain.ChatThread, []domain.ChatMessage, error) {
	if err := validAfter(after); err != nil {
		return domain.ChatThread{}, nil, err
	}
	t, err := s.repo.EnsureThread(ctx, userID)
	if err != nil {
		return domain.ChatThread{}, nil, err
	}
	msgs, err := s.repo.Messages(ctx, t.ID, after, domain.ChatPageSize, domain.ChatAuthorUser)
	return t, msgs, err
}

// UserRead: the user has read their thread up to upTo (the read marker of their own thread only).
func (s *SupportService) UserRead(ctx context.Context, userID uuid.UUID, upTo int64) error {
	if err := validAfter(upTo); err != nil {
		return fmt.Errorf("%w: up_to must not be negative", domain.ErrValidation)
	}
	t, err := s.repo.EnsureThread(ctx, userID)
	if err != nil {
		return err
	}
	return s.repo.MarkUserRead(ctx, userID, t.ID, upTo)
}

// UserPost adds the user's message to their thread. Message texts are never logged.
func (s *SupportService) UserPost(ctx context.Context, userID uuid.UUID, body string, image []byte) (domain.ChatMessage, error) {
	m, img, err := newChatMessage(ChatViewer{UserID: userID}, body, image)
	if err != nil {
		return domain.ChatMessage{}, err
	}
	t, err := s.repo.EnsureThread(ctx, userID)
	if err != nil {
		return domain.ChatMessage{}, err
	}
	return s.repo.AddMessage(ctx, t.ID, m, img)
}

// UserImage: a photo from the user's own thread (not of a hidden message; else ErrNotFound).
func (s *SupportService) UserImage(ctx context.Context, userID uuid.UUID, messageID int64) (domain.ChatImage, error) {
	t, err := s.repo.EnsureThread(ctx, userID)
	if err != nil {
		return domain.ChatImage{}, err
	}
	m, img, err := s.repo.MessageImage(ctx, t.ID, messageID)
	if err != nil {
		return domain.ChatImage{}, err
	}
	if m.Hidden {
		return domain.ChatImage{}, domain.ErrNotFound
	}
	return img, nil
}

// Threads: the admins' list of support threads.
func (s *SupportService) Threads(ctx context.Context, unreadOnly bool) ([]domain.ChatThread, error) {
	return s.repo.Threads(ctx, unreadOnly, supportThreadListLimit)
}

// AdminMessages: a thread and up to ChatPageSize of its messages after `after`, hidden ones too.
// Reading does not mark it read (MarkRead does).
func (s *SupportService) AdminMessages(ctx context.Context, threadID, after int64) (domain.ChatThread, []domain.ChatMessage, error) {
	if err := validAfter(after); err != nil {
		return domain.ChatThread{}, nil, err
	}
	t, err := s.repo.Thread(ctx, threadID)
	if err != nil {
		return domain.ChatThread{}, nil, err
	}
	msgs, err := s.repo.Messages(ctx, threadID, after, domain.ChatPageSize, domain.ChatAuthorAdmin)
	return t, msgs, err
}

// AdminPost adds an admin's message; a visible one tells the user (Telegram, else push), without
// its text.
func (s *SupportService) AdminPost(ctx context.Context, adminID uuid.UUID, threadID int64, body string, image []byte) (domain.ChatMessage, error) {
	m, img, err := newChatMessage(ChatViewer{UserID: adminID, Admin: true}, body, image)
	if err != nil {
		return domain.ChatMessage{}, err
	}
	t, err := s.repo.Thread(ctx, threadID)
	if err != nil {
		return domain.ChatMessage{}, err
	}
	saved, err := s.repo.AddMessage(ctx, threadID, m, img)
	if err != nil {
		return domain.ChatMessage{}, err
	}
	if !saved.Hidden {
		chatNotifier{push: s.push, telegram: s.telegram, wg: &s.wg}.notify(ctx, t.UserID,
			"Новый ответ в поддержке Yodla. Откройте сайт, чтобы ответить.",
			"Новый ответ в поддержке Yodla", "Откройте сайт, чтобы ответить.")
	}
	return saved, nil
}

// MarkRead: the admins have read the thread up to upTo (0 = its newest message); the unread count
// is what came after. Returns the thread with the new count.
func (s *SupportService) MarkRead(ctx context.Context, threadID, upTo int64) (domain.ChatThread, error) {
	if upTo < 0 {
		return domain.ChatThread{}, fmt.Errorf("%w: up_to must not be negative", domain.ErrValidation)
	}
	if _, err := s.repo.Thread(ctx, threadID); err != nil {
		return domain.ChatThread{}, err
	}
	if err := s.repo.MarkRead(ctx, threadID, upTo); err != nil {
		return domain.ChatThread{}, err
	}
	return s.repo.Thread(ctx, threadID)
}

// AdminImage: a photo from any support thread.
func (s *SupportService) AdminImage(ctx context.Context, threadID, messageID int64) (domain.ChatImage, error) {
	if _, err := s.repo.Thread(ctx, threadID); err != nil {
		return domain.ChatImage{}, err
	}
	_, img, err := s.repo.MessageImage(ctx, threadID, messageID)
	return img, err
}

// Wait blocks until the notifications started so far are done (tests; graceful shutdown).
func (s *SupportService) Wait() { s.wg.Wait() }
