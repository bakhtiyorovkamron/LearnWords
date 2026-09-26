package service

import (
	"context"

	"github.com/google/uuid"
)

// DeleteCard removes a word from the user's collection.
func (s *ContextService) DeleteCard(ctx context.Context, userID, cardID uuid.UUID) error {
	ctx, span := tracer.Start(ctx, "ContextService.DeleteCard")
	defer span.End()
	return s.cards.Delete(ctx, userID, cardID)
}
