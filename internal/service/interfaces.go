package service

import (
	"context"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// Repository interfaces are declared on the consumer side, so services can be tested with fakes
// and storage can later be swapped (e.g. a gRPC client in a microservice setup).

type UserRepository interface {
	Create(ctx context.Context, u *domain.User) error
	GetByEmail(ctx context.Context, email string) (*domain.User, error)
	GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error)
}

type ContextRepository interface {
	CreateWithCards(ctx context.Context, c *domain.Context, cards []domain.WordCard) error
	ListByUser(ctx context.Context, userID uuid.UUID, limit, offset int) ([]domain.Context, error)
	GetByID(ctx context.Context, userID, id uuid.UUID) (*domain.Context, error)
	Delete(ctx context.Context, userID, id uuid.UUID) error
}

type WordCardRepository interface {
	ListByContext(ctx context.Context, userID, contextID uuid.UUID) ([]domain.WordCard, error)
	ListByUser(ctx context.Context, userID uuid.UUID, limit, offset int) ([]domain.WordCard, error)
	GetByID(ctx context.Context, userID, id uuid.UUID) (*domain.WordCard, error)
	UpdateAudioURL(ctx context.Context, userID, id uuid.UUID, url string) error
	UpdateExample(ctx context.Context, userID, id uuid.UUID, sentence, translation string) error
	Delete(ctx context.Context, userID, id uuid.UUID) error
}

type TokenManager interface {
	IssuePair(userID uuid.UUID) (domain.TokenPair, error)
	Parse(token, expectedType string) (uuid.UUID, error)
}
