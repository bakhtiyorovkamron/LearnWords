// Package auth issues and validates JWT access/refresh tokens.
package auth

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"learnwords/internal/domain"
)

const (
	TypeAccess  = "access"
	TypeRefresh = "refresh"
)

type Claims struct {
	Type string `json:"typ"`
	jwt.RegisteredClaims
}

type TokenManager struct {
	secret     []byte
	issuer     string
	accessTTL  time.Duration
	refreshTTL time.Duration
}

func NewTokenManager(secret, issuer string, accessTTL, refreshTTL time.Duration) *TokenManager {
	return &TokenManager{secret: []byte(secret), issuer: issuer, accessTTL: accessTTL, refreshTTL: refreshTTL}
}

func (m *TokenManager) IssuePair(userID uuid.UUID) (domain.TokenPair, error) {
	access, aExp, err := m.issue(userID, TypeAccess, m.accessTTL)
	if err != nil {
		return domain.TokenPair{}, err
	}
	refresh, rExp, err := m.issue(userID, TypeRefresh, m.refreshTTL)
	if err != nil {
		return domain.TokenPair{}, err
	}
	return domain.TokenPair{
		AccessToken: access, RefreshToken: refresh,
		AccessExpiresAt: aExp, RefreshExpiresAt: rExp,
	}, nil
}

func (m *TokenManager) issue(userID uuid.UUID, typ string, ttl time.Duration) (string, time.Time, error) {
	now := time.Now()
	exp := now.Add(ttl)
	claims := Claims{
		Type: typ,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        uuid.NewString(),
			Subject:   userID.String(),
			Issuer:    m.issuer,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(exp),
		},
	}
	s, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(m.secret)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("sign token: %w", err)
	}
	return s, exp, nil
}

// Parse validates the token and ensures it has the expected type. Returns the user ID.
func (m *TokenManager) Parse(token, expectedType string) (uuid.UUID, error) {
	claims := &Claims{}
	_, err := jwt.ParseWithClaims(token, claims,
		func(*jwt.Token) (any, error) { return m.secret, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(m.issuer),
		jwt.WithExpirationRequired(),
	)
	if err != nil || claims.Type != expectedType {
		return uuid.Nil, domain.ErrUnauthorized
	}
	id, err := uuid.Parse(claims.Subject)
	if err != nil {
		return uuid.Nil, domain.ErrUnauthorized
	}
	return id, nil
}
