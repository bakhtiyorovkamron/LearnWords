// Package selfhosted calls our own TTS container (Piper for de/en/fr, MeloTTS for ko).
package selfhosted

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type TTS struct {
	baseURL string
	http    *http.Client
}

func NewTTS(baseURL string) *TTS {
	return &TTS{
		baseURL: strings.TrimRight(baseURL, "/"),
		// Korean (MeloTTS on CPU) may take a few seconds.
		http: &http.Client{Timeout: 90 * time.Second},
	}
}

func (t *TTS) Synthesize(ctx context.Context, text, lang string) ([]byte, string, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, "", fmt.Errorf("tts: empty text")
	}
	raw, err := json.Marshal(map[string]string{"text": text, "lang": strings.ToLower(lang)})
	if err != nil {
		return nil, "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.baseURL+"/synthesize", bytes.NewReader(raw))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := t.http.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("tts request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return nil, "", err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("tts: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	if len(body) == 0 {
		return nil, "", fmt.Errorf("tts: empty audio")
	}
	return body, "audio/mpeg", nil
}
