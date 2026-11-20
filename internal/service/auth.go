package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"learnwords/internal/auth"
	"learnwords/internal/domain"
)

type AuthService struct {
	users  UserRepository
	tokens TokenManager
	// dummyHash is used to equalize timing when the user does not exist.
	dummyHash []byte
	starter   StarterCreator
}

// StarterCreator gives a brand-new user their starter folder.
type StarterCreator interface {
	Create(ctx context.Context, userID uuid.UUID, learningLang string) error
}

// SetStarter turns the starter folder on for new registrations (nil = off).
func (s *AuthService) SetStarter(st StarterCreator) { s.starter = st }

// giveStarterFolder never fails the registration: no starter folder is better than a failed sign-up.
func (s *AuthService) giveStarterFolder(ctx context.Context, userID uuid.UUID, learningLang string) {
	giveStarterFolder(ctx, s.starter, userID, learningLang)
}

// giveStarterFolder creates the starter folder with st (nil = off); a failure or a panic is only logged.
func giveStarterFolder(ctx context.Context, st StarterCreator, userID uuid.UUID, learningLang string) {
	if st == nil {
		return
	}
	defer func() {
		if r := recover(); r != nil {
			slog.ErrorContext(ctx, "starter folder panicked", "user", userID, "panic", r)
		}
	}()
	if err := st.Create(ctx, userID, learningLang); err != nil {
		slog.WarnContext(ctx, "starter folder failed", "user", userID, "err", err)
	}
}

// FirstLanguageStore sets the learning language of an account created by Telegram (postgres.UserRepository).
type FirstLanguageStore interface {
	// SetFirstLearningLanguage sets it and clears needs_language, only while needs_language is set;
	// false = the account has chosen already (nothing changes).
	SetFirstLearningLanguage(ctx context.Context, id uuid.UUID, lang string) (bool, error)
}

// LearningLanguageService is the one question an account created by Telegram is asked (/welcome).
type LearningLanguageService struct {
	store   FirstLanguageStore
	starter StarterCreator // nil = no starter folder
}

func NewLearningLanguageService(store FirstLanguageStore, starter StarterCreator) *LearningLanguageService {
	return &LearningLanguageService{store: store, starter: starter}
}

// Choose sets the learning language, once (ErrLanguageChosen after that, and for every account that
// chose it at registration), and gives the starter folder in it.
func (s *LearningLanguageService) Choose(ctx context.Context, userID uuid.UUID, lang string) error {
	lang = strings.ToLower(strings.TrimSpace(lang))
	if !domain.IsLearningLang(lang) {
		return fmt.Errorf("%w: learning_language must be one of: de, en, fr, ko", domain.ErrValidation)
	}
	ok, err := s.store.SetFirstLearningLanguage(ctx, userID, lang)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrLanguageChosen
	}
	giveStarterFolder(ctx, s.starter, userID, lang)
	return nil
}

func NewAuthService(users UserRepository, tokens TokenManager) *AuthService {
	h, _ := bcrypt.GenerateFromPassword([]byte("dummy-password"), bcrypt.DefaultCost)
	return &AuthService{users: users, tokens: tokens, dummyHash: h}
}

func (s *AuthService) Register(ctx context.Context, email, password, learningLang string) (*domain.User, domain.TokenPair, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	// The Telegram domain is the accounts the bot creates: it is not anyone's mailbox.
	if _, err := mail.ParseAddress(email); err != nil || domain.IsTelegramEmail(email) {
		return nil, domain.TokenPair{}, fmt.Errorf("%w: invalid email", domain.ErrValidation)
	}
	if len(password) < 8 || len(password) > 72 {
		return nil, domain.TokenPair{}, fmt.Errorf("%w: password must be 8-72 characters", domain.ErrValidation)
	}
	learningLang = strings.ToLower(strings.TrimSpace(learningLang))
	if learningLang == "" {
		learningLang = domain.DefaultLearningLang
	}
	if !domain.IsLearningLang(learningLang) {
		return nil, domain.TokenPair{}, fmt.Errorf("%w: learning_language must be one of: de, en, fr, ko", domain.ErrValidation)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, domain.TokenPair{}, err
	}
	now := time.Now().UTC()
	u := &domain.User{ID: uuid.New(), Email: email, PasswordHash: string(hash), Role: domain.RoleUser,
		LearningLanguage: learningLang, CreatedAt: now, UpdatedAt: now}
	if err := s.users.Create(ctx, u); err != nil {
		return nil, domain.TokenPair{}, err
	}
	s.giveStarterFolder(ctx, u.ID, u.LearningLanguage)
	pair, err := s.tokens.IssuePair(u.ID)
	return u, pair, err
}

func (s *AuthService) Login(ctx context.Context, email, password string) (domain.TokenPair, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	u, err := s.users.GetByEmail(ctx, email)
	if errors.Is(err, domain.ErrNotFound) {
		_ = bcrypt.CompareHashAndPassword(s.dummyHash, []byte(password))
		return domain.TokenPair{}, domain.ErrInvalidCredentials
	}
	if err != nil {
		return domain.TokenPair{}, err
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) != nil {
		return domain.TokenPair{}, domain.ErrInvalidCredentials
	}
	// Checked after the password so a ban doesn't reveal that the email exists.
	if u.IsBanned {
		return domain.TokenPair{}, domain.ErrBanned
	}
	return s.tokens.IssuePair(u.ID)
}

func (s *AuthService) Refresh(ctx context.Context, refreshToken string) (domain.TokenPair, error) {
	uid, err := s.tokens.Parse(refreshToken, auth.TypeRefresh)
	if err != nil {
		return domain.TokenPair{}, domain.ErrUnauthorized
	}
	u, err := s.users.GetByID(ctx, uid)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return domain.TokenPair{}, domain.ErrUnauthorized
		}
		return domain.TokenPair{}, err
	}
	if u.IsBanned {
		return domain.TokenPair{}, domain.ErrBanned
	}
	return s.tokens.IssuePair(uid)
}
