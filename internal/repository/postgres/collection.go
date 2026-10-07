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
	where := []string{"w.user_id = $1"}
	args := []any{userID}
	arg := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}

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

	if q := strings.TrimSpace(f.Q); q != "" {
		// Escape LIKE wildcards in user input.
		q = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
		p := arg("%" + q + "%")
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

	// Fixed whitelist → no SQL injection through the sort parameter.
	order := "w.created_at DESC"
	switch f.Sort {
	case "alpha":
		order = "lower(w.word) ASC, w.created_at DESC"
	case "progress":
		// Weakest first: not learned before learned, then lowest box, then longest unseen.
		order = "COALESCE(p.is_learned, false) ASC, COALESCE(p.box_level, 1) ASC, p.last_reviewed_at ASC NULLS FIRST, w.created_at DESC"
	}

	base := ` FROM word_cards w LEFT JOIN word_progress p ON p.word_id = w.id WHERE ` + strings.Join(where, " AND ")

	var total int
	if err := r.pool.QueryRow(ctx, `SELECT count(*)`+base, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	q := `SELECT w.id, w.context_id, w.user_id, w.word, w.translation, w.transcription, w.audio_url,
	             w.language, w.created_at, COALESCE(w.example_sentence, ''), COALESCE(w.example_translation, ''),
	             COALESCE(p.box_level, 1), COALESCE(p.is_learned, false), w.folder_id` +
		base + ` ORDER BY ` + order + ` LIMIT ` + arg(f.Limit) + ` OFFSET ` + arg(f.Offset)
	rows, err := r.pool.Query(ctx, q, args...)
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
