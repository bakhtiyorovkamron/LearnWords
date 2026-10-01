package service

import (
	"context"

	"github.com/google/uuid"
)

// DeleteContext removes a context (and its words) owned by the user.
func (s *ContextService) DeleteContext(ctx context.Context, userID, contextID uuid.UUID) error {
	ctx, span := tracer.Start(ctx, "ContextService.DeleteContext")
	defer span.End()
	return s.contexts.Delete(ctx, userID, contextID)
}
