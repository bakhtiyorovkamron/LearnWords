package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

// limitRepo stores words like ContextRepository: the guard sees the user's state inside the "transaction".
type limitRepo struct {
	q     domain.WordQuota
	saved int
}

func (r *limitRepo) CreateWithCards(_ context.Context, _ *domain.Context, cards []domain.WordCard, guard domain.WordGuard) error {
	if guard != nil {
		if err := guard(r.q, len(cards)); err != nil {
			return err
		}
	}
	r.saved += len(cards)
	r.q.Words += len(cards)
	return nil
}

type noExisting struct{}

func (noExisting) HasWord(context.Context, uuid.UUID, ...string) (bool, error) { return false, nil }

// wordRouter: the two JSON routes that add one word, the limit of 50 on (bot configured).
func wordRouter(repo *limitRepo) *gin.Engine {
	gin.SetMode(gin.TestMode)
	limit := service.NewWordLimit(nil, 50, true)
	ctxSvc := service.NewContextService(repo, nil, service.Providers{}).WithWordLimit(limit)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(userIDKey, uuid.New())
		c.Request = c.Request.WithContext(domain.WithLang(c.Request.Context(), "de"))
	})
	r.POST("/api/contexts", NewContextHandler(ctxSvc).Create)
	r.POST("/api/search-word/add", NewSearchHandler(service.NewSearchService(nil, noExisting{}, ctxSvc, nil), nil).Add)
	return r
}

func postJSON(r *gin.Engine, path, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w
}

const wantTelegramRequired = `{"error":"link Telegram to add more words","code":"telegram_required","limit":50,"words":50}`

func TestWordLimit_ManualAdd_49Then50(t *testing.T) {
	repo := &limitRepo{q: domain.WordQuota{Words: 49}}
	r := wordRouter(repo)
	if w := postJSON(r, "/api/contexts", `{"text":"Hund","meaning":"собака","example_sentence":"Der ___."}`); w.Code != http.StatusCreated {
		t.Fatalf("the 50th word: %d %s", w.Code, w.Body)
	}
	w := postJSON(r, "/api/contexts", `{"text":"Katze","meaning":"кошка","example_sentence":"Die ___."}`)
	if w.Code != http.StatusForbidden || strings.TrimSpace(w.Body.String()) != wantTelegramRequired {
		t.Fatalf("the 51st word: %d %s", w.Code, w.Body)
	}
	if repo.saved != 1 {
		t.Errorf("saved %d words, want 1", repo.saved)
	}
}

func TestWordLimit_SearchAdd_TelegramRequired(t *testing.T) {
	repo := &limitRepo{q: domain.WordQuota{Words: 50}}
	w := postJSON(wordRouter(repo), "/api/search-word/add", `{"word":"der Hund","translation":"собака","example_sentence":"Der Hund schläft."}`)
	if w.Code != http.StatusForbidden || strings.TrimSpace(w.Body.String()) != wantTelegramRequired {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if repo.saved != 0 {
		t.Errorf("saved %d", repo.saved)
	}
}

func TestWordLimit_ErrorAlwaysCarriesTheCount_AlsoZero(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/x", func(c *gin.Context) { writeError(c, &domain.WordLimitError{Limit: 50, Words: 0}) })
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/x", nil))
	if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), `"limit":50,"words":0`) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

func sharedLimitRouter(f *fakeShared) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewSharedHandler(f, service.NewWordLimit(nil, 50, true))
	r.POST("/api/shared/:token/import", func(c *gin.Context) {
		c.Set(userIDKey, uuid.New())
		c.Request = c.Request.WithContext(domain.WithLang(c.Request.Context(), "de"))
	}, h.Import)
	return r
}

func TestWordLimit_SharedImport_AllOrNothing(t *testing.T) {
	// 45 words, 10 new in the folder: it does not fit → rejected whole, with how many there are now.
	f := &fakeShared{quota: domain.WordQuota{Words: 45}, newWords: 10}
	w := do(sharedLimitRouter(f), http.MethodPost, "/api/shared/"+goodToken+"/import", nil)
	if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), `"code":"telegram_required","limit":50,"words":45`) {
		t.Fatalf("does not fit: %d %s", w.Code, w.Body)
	}
	// 5 new words fit exactly.
	f = &fakeShared{quota: domain.WordQuota{Words: 45}, newWords: 5}
	if w := do(sharedLimitRouter(f), http.MethodPost, "/api/shared/"+goodToken+"/import", nil); w.Code != http.StatusOK {
		t.Fatalf("fits: %d %s", w.Code, w.Body)
	}
}

type quotaOf struct{ q domain.WordQuota }

func (m quotaOf) WordQuota(context.Context, uuid.UUID) (domain.WordQuota, error) { return m.q, nil }

func TestProfile_Words(t *testing.T) {
	for name, tc := range map[string]struct {
		q    domain.WordQuota
		bot  bool
		want string
	}{
		"not linked": {domain.WordQuota{Words: 47}, true, `{"count":47,"limit":50}`},
		"linked":     {domain.WordQuota{Words: 47, TelegramLinked: true}, true, `{"count":47,"limit":null}`},
		"admin":      {domain.WordQuota{Words: 47, Admin: true}, true, `{"count":47,"limit":null}`},
		"no bot":     {domain.WordQuota{Words: 47}, false, `{"count":47,"limit":null}`},
	} {
		words := service.NewWordLimit(quotaOf{tc.q}, 50, tc.bot)
		w := httptest.NewRecorder()
		profileRouterWords(&memProfile{}, words, tc.bot).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/me/profile", nil))
		var out struct {
			Words json.RawMessage `json:"words"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || string(out.Words) != tc.want {
			t.Errorf("%s: words = %s (%v), want %s", name, out.Words, err, tc.want)
		}
	}
}
