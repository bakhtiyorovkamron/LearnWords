// Package provider defines interfaces for external integrations (OCR, translation, TTS, images, storage).
// Real implementations (Tesseract/Vision, DeepL/Google, Google TTS/Azure, Openverse, S3/local disk) plug in here.
package provider

import (
	"context"

	"learnwords/internal/domain"
)

type OCR interface {
	ExtractText(ctx context.Context, image []byte, lang string) (string, error)
}

type Translator interface {
	Translate(ctx context.Context, text, sourceLang, targetLang string) (string, error)
}

type Transcriber interface {
	// Transcribe returns phonetic (IPA) transcription.
	Transcribe(ctx context.Context, word, lang string) (string, error)
}

type TTS interface {
	// Synthesize returns audio bytes and their MIME type.
	Synthesize(ctx context.Context, text, lang string) ([]byte, string, error)
}

// ImageSearch finds illustrative photos for a text query.
type ImageSearch interface {
	Search(ctx context.Context, query string, limit int) ([]domain.Photo, error)
}

type FileStorage interface {
	// Upload stores the object and returns its public URL.
	Upload(ctx context.Context, key string, data []byte, contentType string) (string, error)
}
