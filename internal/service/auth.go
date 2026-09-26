package service

import (
	"context"
	"errors"
	"fmt"
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
}

func NewAuthService(users UserRepository, tokens TokenManager) *AuthService {
	h, _ := bcrypt.GenerateFromPassword([]byte("dummy-password"), bcrypt.DefaultCost)
	return &AuthService{users: users, tokens: tokens, dummyHash: h}
}

func (s *AuthService) Register(ctx context.Context, email, password string) (*domain.User, domain.TokenPair, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if _, err := mail.ParseAddress(email); err != nil {
		return nil, domain.TokenPair{}, fmt.Errorf("%w: invalid email", domain.ErrValidation)
	}
	if len(password) < 8 || len(password) > 72 {
		return nil, domain.TokenPair{}, fmt.Errorf("%w: password must be 8-72 characters", domain.ErrValidation)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, domain.TokenPair{}, err
	}
	now := time.Now().UTC()
	u := &domain.User{ID: uuid.New(), Email: email, PasswordHash: string(hash), CreatedAt: now, UpdatedAt: now}
	if err := s.users.Create(ctx, u); err != nil {
		return nil, domain.TokenPair{}, err
	}
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
	return s.tokens.IssuePair(u.ID)
}

func (s *AuthService) Refresh(ctx context.Context, refreshToken string) (domain.TokenPair, error) {
	uid, err := s.tokens.Parse(refreshToken, auth.TypeRefresh)
	if err != nil {
		return domain.TokenPair{}, domain.ErrUnauthorized
	}
	if _, err := s.users.GetByID(ctx, uid); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return domain.TokenPair{}, domain.ErrUnauthorized
		}
		return domain.TokenPair{}, err
	}
	return s.tokens.IssuePair(uid)
}
