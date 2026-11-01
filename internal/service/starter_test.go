package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/auth"
	"learnwords/internal/domain"
)

type memStarterStore struct {
	folder *domain.Folder
	items  []domain.ContextWithCards
	err    error
}

func (m *memStarterStore) CreateFolderWithContexts(_ context.Context, f *domain.Folder, items []domain.ContextWithCards) error {
	if m.err != nil {
		return m.err
	}
	m.folder, m.items = f, items
	return nil
}

func TestStarter_Create_FolderAndCardsInTheRequestLanguage(t *testing.T) {
	store := &memStarterStore{}
	svc, err := NewStarterService(store)
	if err != nil {
		t.Fatal(err)
	}
	uid := uuid.New()
	ctx := domain.WithTranslationLang(context.Background(), "uz")
	if err := svc.Create(ctx, uid, "de"); err != nil {
		t.Fatal(err)
	}
	if store.folder.Name != "Tanishuv" || store.folder.UserID != uid || store.folder.Color == "" || len(store.items) != 15 {
		t.Fatalf("folder %+v, %d items", store.folder, len(store.items))
	}
	first := store.items[0].Cards[0]
	if first.Word != "Hallo!" || first.Translation != "Salom!" || first.ExampleSentence != "___ Ich heiße Anna." || first.Language != "de" {
		t.Errorf("first card %+v", first)
	}
	for i, it := range store.items {
		c := it.Cards[0]
		if !c.Paused || c.FolderID == nil || *c.FolderID != store.folder.ID || c.UserID != uid || c.ContextID != it.Context.ID {
			t.Fatalf("card %d: %+v", i, c)
		}
		if c.TranslationLanguage == nil || *c.TranslationLanguage != "uz" || c.ExampleTranslationLanguage == nil || *c.ExampleTranslationLanguage != "uz" {
			t.Errorf("card %d languages: %v %v", i, c.TranslationLanguage, c.ExampleTranslationLanguage)
		}
		if c.PartOfSpeech == nil || *c.PartOfSpeech != "phrase" || c.Lemma != nil || c.Article != nil || c.Plural != nil {
			t.Errorf("card %d grammar: %+v", i, c)
		}
		if i > 0 && !c.CreatedAt.After(store.items[i-1].Cards[0].CreatedAt) {
			t.Errorf("card %d is not after the previous one: the file order must be kept", i)
		}
	}
}

func TestStarter_Create_NoLanguageFallsBackToRussian_KoreanHasTranscription(t *testing.T) {
	store := &memStarterStore{}
	svc, _ := NewStarterService(store)
	if err := svc.Create(context.Background(), uuid.New(), "ko"); err != nil { // no interface language in ctx
		t.Fatal(err)
	}
	if store.folder.Name != "Знакомство" {
		t.Errorf("folder %q", store.folder.Name)
	}
	c := store.items[0].Cards[0]
	if c.Transcription == "" || c.Language != "ko" || *c.TranslationLanguage != "ru" {
		t.Errorf("ko card %+v", c)
	}
	// an unknown language code is normalized to the default as well
	store2 := &memStarterStore{}
	svc2, _ := NewStarterService(store2)
	if err := svc2.Create(domain.WithTranslationLang(context.Background(), "xx"), uuid.New(), "en"); err != nil {
		t.Fatal(err)
	}
	if store2.folder.Name != "Знакомство" || store2.items[0].Cards[0].Translation != "Привет!" {
		t.Errorf("unknown language: %q / %q", store2.folder.Name, store2.items[0].Cards[0].Translation)
	}
}

func TestStarter_Create_UnknownLearningLanguageMakesNothing(t *testing.T) {
	store := &memStarterStore{}
	svc, _ := NewStarterService(store)
	if err := svc.Create(context.Background(), uuid.New(), "xx"); err != nil || store.folder != nil {
		t.Errorf("err %v, folder %+v", err, store.folder)
	}
}

// --- registration never fails because of the starter folder ---

type memUsers struct{ created []*domain.User }

func (m *memUsers) Create(_ context.Context, u *domain.User) error {
	m.created = append(m.created, u)
	return nil
}
func (m *memUsers) GetByEmail(context.Context, string) (*domain.User, error) {
	return nil, domain.ErrNotFound
}
func (m *memUsers) GetByID(context.Context, uuid.UUID) (*domain.User, error) {
	return nil, domain.ErrNotFound
}

type fakeStarter struct {
	err      error
	panics   bool
	calls    int
	lastUser uuid.UUID
	lastLang string
}

func (f *fakeStarter) Create(_ context.Context, id uuid.UUID, lang string) error {
	f.calls++
	f.lastUser, f.lastLang = id, lang
	if f.panics {
		panic("boom")
	}
	return f.err
}

func newAuth(st StarterCreator) (*AuthService, *memUsers) {
	users := &memUsers{}
	svc := NewAuthService(users, auth.NewTokenManager("secret-secret-secret-secret-1234", "test", time.Minute, time.Hour))
	svc.SetStarter(st)
	return svc, users
}

func TestRegister_GivesTheStarterFolderToTheNewUser(t *testing.T) {
	st := &fakeStarter{}
	svc, users := newAuth(st)
	u, tokens, err := svc.Register(context.Background(), "new@example.com", "password123", "ko")
	if err != nil || tokens.AccessToken == "" {
		t.Fatalf("register: %v", err)
	}
	if st.calls != 1 || st.lastUser != u.ID || st.lastLang != "ko" || len(users.created) != 1 {
		t.Errorf("starter calls %d for %v (%s)", st.calls, st.lastUser, st.lastLang)
	}
}

func TestRegister_AStarterFailureOrPanicDoesNotFailTheSignUp(t *testing.T) {
	for name, st := range map[string]*fakeStarter{
		"error": {err: errors.New("db down")},
		"panic": {panics: true},
	} {
		svc, users := newAuth(st)
		u, tokens, err := svc.Register(context.Background(), "x@example.com", "password123", "de")
		if err != nil || u == nil || tokens.AccessToken == "" || len(users.created) != 1 {
			t.Errorf("%s: register failed: %v", name, err)
		}
		if st.calls != 1 {
			t.Errorf("%s: starter calls %d", name, st.calls)
		}
	}
}

func TestRegister_WithoutAStarterStillWorks_AndAFailedSignUpGetsNoFolder(t *testing.T) {
	svc, _ := newAuth(nil)
	if _, _, err := svc.Register(context.Background(), "a@example.com", "password123", "de"); err != nil {
		t.Fatal(err)
	}
	st := &fakeStarter{}
	svc2, _ := newAuth(st)
	if _, _, err := svc2.Register(context.Background(), "not-an-email", "password123", "de"); err == nil {
		t.Fatal("an invalid email must be refused")
	}
	if st.calls != 0 {
		t.Errorf("starter ran for a refused registration: %d", st.calls)
	}
}
