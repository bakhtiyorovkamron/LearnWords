package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"learnwords/internal/domain"
)

func TestNativeLang_HeaderBecomesTheTranslationLanguage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var got string
	r := gin.New()
	r.Use(NativeLang())
	r.GET("/x", func(c *gin.Context) { got = domain.TranslationLangFrom(c.Request.Context()) })

	for header, want := range map[string]string{
		"uz": "uz", "EN": "en", " ru ": "ru",
		"":   "ru", // no header → the default
		"fr": "ru", // unsupported → the default
	} {
		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		if header != "" {
			req.Header.Set(NativeLanguageHeader, header)
		}
		r.ServeHTTP(httptest.NewRecorder(), req)
		if got != want {
			t.Errorf("%q → %q, want %q", header, got, want)
		}
	}
}
