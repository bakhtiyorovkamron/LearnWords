package postgres

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"learnwords/internal/domain"
)

type UserRepository struct{ pool *pgxpool.Pool }

func NewUserRepository(pool *pgxpool.Pool) *UserRepository { return &UserRepository{pool: pool} }

func (r *UserRepository) Create(ctx context.Context, u *domain.User) error {
	if u.LearningLanguage == "" {
		u.LearningLanguage = domain.DefaultLearningLang
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO users (id, email, password_hash, learning_language, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)`,
		u.ID, u.Email, u.PasswordHash, u.LearningLanguage, u.CreatedAt, u.UpdatedAt)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return domain.ErrAlreadyExists
	}
	return err
}

const userCols = `id, email, password_hash, role, is_banned, learning_language, created_at, updated_at`

func (r *UserRepository) GetByEmail(ctx context.Context, email string) (*domain.User, error) {
	return r.getOne(ctx, `SELECT `+userCols+` FROM users WHERE email = $1`, email)
}

func (r *UserRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	return r.getOne(ctx, `SELECT `+userCols+` FROM users WHERE id = $1`, id)
}

func (r *UserRepository) getOne(ctx context.Context, q string, arg any) (*domain.User, error) {
	var u domain.User
	err := r.pool.QueryRow(ctx, q, arg).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Role, &u.IsBanned, &u.LearningLanguage, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}
