package domain

import (
	"context"
	"strings"
)

// Learning languages a user can pick at registration. It is fixed per account
// (all cards, stories, search and AI prompts use it). Default — German.
const DefaultLearningLang = "de"

type LangInfo struct {
	Code   string // "de"
	NameRU string // name in Russian, used in AI prompts ("немецком")
	NameEN string // English name for logs/prompts
	// Articles is true for languages whose nouns carry articles worth learning (der/die/das, le/la).
	Articles bool
}

var learningLangs = map[string]LangInfo{
	"de": {Code: "de", NameRU: "немецкий", NameEN: "German", Articles: true},
	"en": {Code: "en", NameRU: "английский", NameEN: "English"},
	"fr": {Code: "fr", NameRU: "французский", NameEN: "French", Articles: true},
	"ko": {Code: "ko", NameRU: "корейский", NameEN: "Korean"},
}

// IsLearningLang reports whether code is a supported learning language.
func IsLearningLang(code string) bool {
	_, ok := learningLangs[strings.ToLower(strings.TrimSpace(code))]
	return ok
}

// Lang returns info for code, falling back to German.
func Lang(code string) LangInfo {
	if l, ok := learningLangs[strings.ToLower(strings.TrimSpace(code))]; ok {
		return l
	}
	return learningLangs[DefaultLearningLang]
}

type langKey struct{}

// WithLang stores the current user's learning language in ctx (set by the auth middleware).
func WithLang(ctx context.Context, code string) context.Context {
	return context.WithValue(ctx, langKey{}, Lang(code).Code)
}

// LangFrom returns the learning language from ctx ("de" if not set).
func LangFrom(ctx context.Context) string {
	if v, ok := ctx.Value(langKey{}).(string); ok && v != "" {
		return v
	}
	return DefaultLearningLang
}
