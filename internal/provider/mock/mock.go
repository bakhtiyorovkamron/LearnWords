// Package mock provides in-memory fakes of external integrations for local development and tests.
package mock

import (
	"context"
	"strings"
	"sync"
)

type OCR struct{ Text string }

func (o OCR) ExtractText(context.Context, []byte, string) (string, error) {
	if o.Text != "" {
		return o.Text, nil
	}
	return "Guten Morgen! Wie geht es dir heute?", nil
}

type Translator struct{}

var dict = map[string]string{
	"guten": "добрый", "morgen": "утро", "wie": "как", "geht": "идёт",
	"dir": "тебе", "heute": "сегодня", "hallo": "привет", "danke": "спасибо",
}

func (Translator) Translate(_ context.Context, text, _, target string) (string, error) {
	if t, ok := dict[strings.ToLower(text)]; ok && target == "ru" {
		return t, nil
	}
	return "[" + target + "] " + text, nil
}

type Transcriber struct{}

func (Transcriber) Transcribe(_ context.Context, word, _ string) (string, error) {
	return "[" + strings.ToLower(word) + "]", nil
}

type TTS struct{}

func (TTS) Synthesize(context.Context, string, string) ([]byte, string, error) {
	return []byte("fake-mp3"), "audio/mpeg", nil
}

// Storage keeps files in memory and returns mock:// URLs.
type Storage struct {
	mu    sync.RWMutex
	files map[string][]byte
}

func NewStorage() *Storage { return &Storage{files: map[string][]byte{}} }

func (s *Storage) Upload(_ context.Context, key string, data []byte, _ string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.files[key] = data
	return "mock://storage/" + key, nil
}
