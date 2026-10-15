package postgres

import (
	"context"
	"fmt"
	"io/fs"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"learnwords/migrations"
)

// Migrate applies embedded *.up.sql files in lexical order, each in its own transaction.
// Applied versions are tracked in schema_migrations; an advisory lock guards concurrent starts.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	const lockID = 7263541
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, lockID); err != nil {
		return fmt.Errorf("migrate lock: %w", err)
	}
	defer conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, lockID) //nolint:errcheck

	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version    TEXT PRIMARY KEY,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	files, err := fs.Glob(migrations.FS, "*.up.sql")
	if err != nil {
		return err
	}
	sort.Strings(files)

	for _, f := range files {
		version := strings.TrimSuffix(f, ".up.sql")
		var exists bool
		if err := conn.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`, version).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		sql, err := fs.ReadFile(migrations.FS, f)
		if err != nil {
			return err
		}
		tx, err := conn.Begin(ctx)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("apply %s: %w", f, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, version); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("record %s: %w", f, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit %s: %w", f, err)
		}
	}
	return nil
}

// CheckMigrated fails when some embedded migration is not applied. With AUTO_MIGRATE off the
// server must refuse to start on an old schema instead of answering 500 on every request.
func CheckMigrated(ctx context.Context, pool *pgxpool.Pool) error {
	files, err := fs.Glob(migrations.FS, "*.up.sql")
	if err != nil {
		return err
	}
	var pending []string
	rows, err := pool.Query(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return fmt.Errorf("read schema_migrations (is the database migrated?): %w", err)
	}
	defer rows.Close()
	have := map[string]bool{}
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return err
		}
		have[v] = true
	}
	if err := rows.Err(); err != nil {
		return err
	}
	sort.Strings(files)
	for _, f := range files {
		if v := strings.TrimSuffix(f, ".up.sql"); !have[v] {
			pending = append(pending, v)
		}
	}
	if len(pending) > 0 {
		return fmt.Errorf("database schema is out of date, pending migrations: %s (run with AUTO_MIGRATE=true)", strings.Join(pending, ", "))
	}
	return nil
}
