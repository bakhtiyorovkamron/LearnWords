package service

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

// imageDataURL validates an uploaded image and encodes it as a data: URL,
// so it can be shown directly in <img> without a separate file server.
func imageDataURL(data []byte) (string, error) {
	if len(data) == 0 {
		return "", fmt.Errorf("%w: empty image", domain.ErrValidation)
	}
	if len(data) > MaxImageSize {
		return "", fmt.Errorf("%w: image too large", domain.ErrValidation)
	}
	ct := http.DetectContentType(data)
	if _, ok := allowedImageTypes[ct]; !ok {
		return "", fmt.Errorf("%w: unsupported image type %s", domain.ErrValidation, ct)
	}
	return "data:" + ct + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

// UploadPhoto stores a user-uploaded photo for a context.
func (s *ContextService) UploadPhoto(ctx context.Context, userID, contextID uuid.UUID, data []byte) error {
	url, err := imageDataURL(data)
	if err != nil {
		return err
	}
	return s.contexts.UpdatePhoto(ctx, userID, contextID, url, "")
}
