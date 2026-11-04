// Command backfillgap fills word_cards.example_gap_answer for cards saved before the column
// existed: it asks the model which form of the word stands in the "___" of the example.
//
//	go run ./cmd/backfillgap           # dry run: prints what would be written
//	go run ./cmd/backfillgap --apply   # writes it
//
// Needs DATABASE_URL and ANTHROPIC_API_KEY (ANTHROPIC_MODEL optional). A card whose gap form is
// the word itself is skipped and stays NULL (the app then shows the word, which is right).
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"learnwords/internal/config"
	"learnwords/internal/domain"
	"learnwords/internal/provider/anthropic"
	"learnwords/internal/repository/postgres"
)

const batchSize = 50

type card struct {
	ID       uuid.UUID
	Word     string
	Sentence string
	Language string
}

type store interface {
	// Pending: cards with a gap sentence and no gap answer, ordered by id, after the given id.
	Pending(ctx context.Context, after uuid.UUID, limit int) ([]card, error)
	Save(ctx context.Context, id uuid.UUID, answer string) error
}

type asker interface {
	GapForm(ctx context.Context, sentenceWithGap, word string) (string, error)
}

type stats struct{ Asked, Written, Skipped, Failed int }

func main() {
	apply := flag.Bool("apply", false, "write the answers (default: dry run)")
	delay := flag.Duration("delay", 500*time.Millisecond, "pause between batches")
	flag.Parse()
	if err := execute(*apply, *delay); err != nil {
		fmt.Fprintln(os.Stderr, "backfillgap:", err)
		os.Exit(1)
	}
}

func execute(apply bool, delay time.Duration) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	key := os.Getenv("ANTHROPIC_API_KEY")
	if key == "" {
		return fmt.Errorf("ANTHROPIC_API_KEY is not set")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	pool, err := postgres.NewPool(ctx, cfg.DatabaseURL, 2)
	if err != nil {
		return err
	}
	defer pool.Close()

	st, err := run(ctx, pgStore{pool}, anthropic.New(key, os.Getenv("ANTHROPIC_MODEL")), apply, delay, os.Stdout)
	mode := "dry run"
	if apply {
		mode = "applied"
	}
	slog.Info("backfillgap finished", "mode", mode, "asked", st.Asked, "written", st.Written, "skipped", st.Skipped, "failed", st.Failed)
	return err
}

// run walks all pending cards in batches. Without apply nothing is saved.
func run(ctx context.Context, s store, ai asker, apply bool, delay time.Duration, out io.Writer) (stats, error) {
	var st stats
	var after uuid.UUID
	for {
		batch, err := s.Pending(ctx, after, batchSize)
		if err != nil {
			return st, err
		}
		if len(batch) == 0 {
			return st, nil
		}
		for _, c := range batch {
			after = c.ID
			st.Asked++
			cctx := domain.WithLang(ctx, c.Language)
			answer, err := ai.GapForm(cctx, c.Sentence, c.Word)
			if err != nil {
				st.Failed++
				slog.Warn("gap form failed", "card", c.ID, "err", err)
				continue
			}
			if sameForm(answer, c.Word) {
				st.Skipped++
				continue
			}
			fmt.Fprintf(out, "%s  %q  %s  ->  %q\n", c.ID, c.Word, c.Sentence, answer)
			if !apply {
				continue
			}
			if err := s.Save(ctx, c.ID, answer); err != nil {
				return st, err
			}
			st.Written++
		}
		if len(batch) < batchSize {
			return st, nil
		}
		select {
		case <-ctx.Done():
			return st, ctx.Err()
		case <-time.After(delay):
		}
	}
}

// sameForm: the model answered with the word itself (case and a leading article aside).
func sameForm(answer, word string) bool {
	a, w := strings.ToLower(strings.TrimSpace(answer)), strings.ToLower(strings.TrimSpace(word))
	return a == w
}

type pgStore struct{ pool *pgxpool.Pool }

func (p pgStore) Pending(ctx context.Context, after uuid.UUID, limit int) ([]card, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT id, word, example_sentence, language FROM word_cards
		WHERE example_gap_answer IS NULL AND example_sentence LIKE '%\_\_\_%' AND id > $1
		ORDER BY id LIMIT $2`, after, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (card, error) {
		var c card
		err := row.Scan(&c.ID, &c.Word, &c.Sentence, &c.Language)
		return c, err
	})
}

func (p pgStore) Save(ctx context.Context, id uuid.UUID, answer string) error {
	_, err := p.pool.Exec(ctx, `UPDATE word_cards SET example_gap_answer = $2 WHERE id = $1 AND example_gap_answer IS NULL`, id, answer)
	return err
}
