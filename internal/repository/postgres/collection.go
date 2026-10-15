package postgres

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"learnwords/internal/domain"
)

// ListCollection returns the user's cards with progress, filtered and sorted in SQL,
// plus the total number of matching cards (for "load more").
// Cards without a progress row count as box 1, not learned.
func (r *WordCardRepository) ListCollection(ctx context.Context, userID uuid.UUID, f domain.CollectionFilter) ([]domain.CollectionCard, int, error) {
	q := collectionFrom(userID, f)
	order := collectionOrder(f.Sort)

	var total int
	if err := r.pool.QueryRow(ctx, `SELECT count(*)`+q.from, q.args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	sql := `SELECT w.id, w.context_id, w.user_id, w.word, w.translation, w.transcription, w.audio_url,
	             w.language, w.created_at, COALESCE(w.example_sentence, ''), COALESCE(w.example_translation, ''),
	             COALESCE(p.box_level, 1), COALESCE(p.is_learned, false), w.folder_id` +
		q.from + ` ORDER BY ` + order + ` LIMIT ` + q.arg(f.Limit) + ` OFFSET ` + q.arg(f.Offset)
	rows, err := r.pool.Query(ctx, sql, q.args...)
	if err != nil {
		return nil, 0, err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.CollectionCard, error) {
		var c domain.CollectionCard
		err := row.Scan(&c.ID, &c.ContextID, &c.UserID, &c.Word, &c.Translation, &c.Transcription, &c.AudioURL,
			&c.Language, &c.CreatedAt, &c.ExampleSentence, &c.ExampleTranslation, &c.BoxLevel, &c.IsLearned, &c.FolderID)
		return c, err
	})
	return items, total, err
}

// ListCollectionIDs returns the ids of up to f.Limit cards matching the filter (in list order)
// and the total number of matches — for "select all" over every page.
func (r *WordCardRepository) ListCollectionIDs(ctx context.Context, userID uuid.UUID, f domain.CollectionFilter) ([]uuid.UUID, int, error) {
	q := collectionFrom(userID, f)
	var total int
	if err := r.pool.QueryRow(ctx, `SELECT count(*)`+q.from, q.args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := r.pool.Query(ctx, `SELECT w.id`+q.from+` ORDER BY `+collectionOrder(f.Sort)+` LIMIT `+q.arg(f.Limit), q.args...)
	if err != nil {
		return nil, 0, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	return ids, total, err
}

// collectionQuery is " FROM … WHERE …" for a filter with its arguments. The args live in the
// struct, so arg() after building is seen by whoever runs the query (a closure over a returned
// slice would append to a copy).
type collectionQuery struct {
	from string
	args []any
}

// arg adds a query argument and returns its placeholder ("$3").
func (q *collectionQuery) arg(v any) string {
	q.args = append(q.args, v)
	return fmt.Sprintf("$%d", len(q.args))
}

func collectionFrom(userID uuid.UUID, f domain.CollectionFilter) *collectionQuery {
	q := &collectionQuery{args: []any{userID}}
	arg := q.arg
	where := []string{"w.user_id = $1"}

	switch f.Status {
	case "new":
		where = append(where, "COALESCE(p.is_learned, false) = false AND COALESCE(p.box_level, 1) <= 2")
	case "learning":
		where = append(where, "COALESCE(p.is_learned, false) = false AND COALESCE(p.box_level, 1) BETWEEN 3 AND 5")
	case "learned":
		where = append(where, "COALESCE(p.is_learned, false) = true")
	}

	now := time.Now().UTC()
	switch f.Period {
	case "today":
		where = append(where, "w.created_at >= "+arg(time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)))
	case "week":
		where = append(where, "w.created_at >= "+arg(now.AddDate(0, 0, -7)))
	}

	if text := strings.TrimSpace(f.Q); text != "" {
		// Escape LIKE wildcards in user input.
		text = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(text)
		p := arg("%" + text + "%")
		where = append(where, "(w.word ILIKE "+p+" OR w.translation ILIKE "+p+")")
	}

	// Optional folder filter; without it all words are returned (unchanged behaviour).
	if f.Folder != nil {
		if f.Folder.None {
			where = append(where, "w.folder_id IS NULL")
		} else {
			where = append(where, "w.folder_id = "+arg(f.Folder.ID))
		}
	}

	q.from = ` FROM word_cards w LEFT JOIN word_progress p ON p.word_id = w.id WHERE ` + strings.Join(where, " AND ")
	return q
}

// collectionOrder maps the sort parameter to a fixed whitelist → no SQL injection.
func collectionOrder(sort string) string {
	order := "w.created_at DESC"
	switch sort {
	case "alpha":
		order = "lower(w.word) ASC, w.created_at DESC"
	case "progress":
		// Weakest first: not learned before learned, then lowest box, then longest unseen.
		order = "COALESCE(p.is_learned, false) ASC, COALESCE(p.box_level, 1) ASC, p.last_reviewed_at ASC NULLS FIRST, w.created_at DESC"
	}
	return order
}
