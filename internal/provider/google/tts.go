// Package google implements text-to-speech via Google Cloud Text-to-Speech (REST API, Neural2 voices).
package google

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Voices per learning language.
var voices = map[string]struct{ Locale, Voice string }{
	"de": {"de-DE", "de-DE-Neural2-C"},
	"en": {"en-US", "en-US-Neural2-F"},
	"fr": {"fr-FR", "fr-FR-Neural2-A"},
	"ko": {"ko-KR", "ko-KR-Neural2-A"},
}

const endpoint = "https://texttospeech.googleapis.com/v1/text:synthesize"

type TTS struct {
	key  string
	http *http.Client
}

// NewTTS uses an API key restricted to the Cloud Text-to-Speech API.
func NewTTS(key string) *TTS {
	return &TTS{key: key, http: &http.Client{Timeout: 20 * time.Second}}
}

type synthReq struct {
	Input struct {
		Text string `json:"text"`
	} `json:"input"`
	Voice struct {
		LanguageCode string `json:"languageCode"`
		Name         string `json:"name"`
	} `json:"voice"`
	AudioConfig struct {
		AudioEncoding string  `json:"audioEncoding"`
		SpeakingRate  float64 `json:"speakingRate"`
	} `json:"audioConfig"`
}

// Synthesize returns MP3 audio for text in the given language ("de", "en", "fr", "ko").
func (t *TTS) Synthesize(ctx context.Context, text, lang string) ([]byte, string, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, "", fmt.Errorf("google tts: empty text")
	}
	v, ok := voices[strings.ToLower(lang)]
	if !ok {
		return nil, "", fmt.Errorf("google tts: unsupported language %q", lang)
	}

	var body synthReq
	body.Input.Text = text
	body.Voice.LanguageCode = v.Locale
	body.Voice.Name = v.Voice
	body.AudioConfig.AudioEncoding = "MP3"
	body.AudioConfig.SpeakingRate = 0.95 // a bit slower — easier for learners
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		endpoint+"?key="+url.QueryEscape(t.key), bytes.NewReader(raw))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := t.http.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("google tts request: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return nil, "", err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("google tts: status %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}

	var out struct {
		AudioContent string `json:"audioContent"`
	}
	if err := json.Unmarshal(respBody, &out); err != nil {
		return nil, "", fmt.Errorf("google tts: decode: %w", err)
	}
	audio, err := base64.StdEncoding.DecodeString(out.AudioContent)
	if err != nil || len(audio) == 0 {
		return nil, "", fmt.Errorf("google tts: empty or invalid audio")
	}
	return audio, "audio/mpeg", nil
}
