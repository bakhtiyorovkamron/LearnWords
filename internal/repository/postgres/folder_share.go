package postgres

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"learnwords/internal/domain"
)

const (
	shareTokenLen   = 10
	shareTokenTries = 5
	base62          = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
	maxFolderName   = 40 // same limit as the folder form
)

// NewShareToken returns 10 base62 characters from crypto/rand. Bytes ≥ 248 are dropped so that
// every character is equally likely (256 is not a multiple of 62).
func NewShareToken() (string, error) {
	out := make([]byte, 0, shareTokenLen)
	buf := make([]byte, 32)
	for len(out) < shareTokenLen {
		if _, err := rand.Read(buf); err != nil {
			return "", err
		}
		for _, b := range buf {
			if b < 248 && len(out) < shareTokenLen {
				out = append(out, base62[int(b)%62])
			}
		}
	}
	return string(out), nil
}

func isUniqueViolation(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505"
}

// setToken stores a fresh token for the owner's folder, retrying on the (unlikely) collision.
// keepExisting: leave the current token if there is one (enable); otherwise always replace it.
func (r *FolderRepository) setToken(ctx context.Context, userID, id uuid.UUID, keepExisting bool) (string, error) {
	for try := 0; try < shareTokenTries; try++ {
		token, err := NewShareToken()
		if err != nil {
			return "", err
		}
		var got string
		err = r.pool.QueryRow(ctx, `
			UPDATE folders SET
			  share_token = CASE WHEN $4 THEN COALESCE(share_token, $3) ELSE $3 END,
			  shared_at   = CASE WHEN $4 THEN COALESCE(shared_at, now()) ELSE now() END
			WHERE id = $1 AND user_id = $2
			RETURNING share_token`, id, userID, token, keepExisting).Scan(&got)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return "", domain.ErrNotFound // not found or not the owner's
		case isUniqueViolation(err):
			continue
		case err != nil:
			return "", err
		}
		return got, nil
	}
	return "", fmt.Errorf("could not generate a unique share token after %d tries", shareTokenTries)
}

// EnableShare turns the link on, or returns the existing token.
func (r *FolderRepository) EnableShare(ctx context.Context, userID, id uuid.UUID) (string, error) {
	return r.setToken(ctx, userID, id, true)
}

// RegenerateShare issues a new token; the old link stops working.
func (r *FolderRepository) RegenerateShare(ctx context.Context, userID, id uuid.UUID) (string, error) {
	return r.setToken(ctx, userID, id, false)
}

// DisableShare turns the link off (share_token = NULL).
func (r *FolderRepository) DisableShare(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE folders SET share_token = NULL, shared_at = NULL WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// GetShared is the public preview. lang (ru|en|uz, may be empty) picks word_translations over the
// card's own translation. Only plain text fields leave the database — no ids, no owner, no progress.
func (r *FolderRepository) GetShared(ctx context.Context, token, lang string) (*domain.SharedFolder, error) {
	var folderID uuid.UUID
	sf := domain.SharedFolder{Words: []domain.SharedWord{}}
	err := r.pool.QueryRow(ctx, `
		SELECT f.id, f.name, f.color, u.learning_language
		FROM folders f JOIN users u ON u.id = f.user_id
		WHERE f.share_token = $1`, token).Scan(&folderID, &sf.Name, &sf.Color, &sf.Language)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if err := r.pool.QueryRow(ctx, `SELECT count(*) FROM word_cards WHERE folder_id = $1`, folderID).Scan(&sf.WordCount); err != nil {
		return nil, err
	}
	rows, err := r.pool.Query(ctx, `
		SELECT w.word, w.article,
		       COALESCE(NULLIF(t.translation, ''), w.translation),
		       w.transcription,
		       COALESCE(w.example_sentence, ''),
		       COALESCE(NULLIF(t.example_translation, ''), w.example_translation, '')
		FROM word_cards w
		LEFT JOIN word_translations t ON t.word_id = w.id AND t.language = $2
		WHERE w.folder_id = $1
		ORDER BY w.created_at, w.id
		LIMIT $3`, folderID, lang, domain.MaxSharedWords)
	if err != nil {
		return nil, err
	}
	words, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.SharedWord, error) {
		var w domain.SharedWord
		err := row.Scan(&w.Word, &w.Article, &w.Translation, &w.Transcription, &w.ExampleSentence, &w.ExampleTranslation)
		return w, err
	})
	if err != nil {
		return nil, err
	}
	if words != nil {
		sf.Words = words
	}
	return &sf, nil
}

// spellings: the forms under which a word counts as "the same" — as written and without a leading
// article ("der Hund" ↔ "Hund"), lower-cased, spaces trimmed. Both directions are compared, so it
// does not matter which side carries the article (HasWord only handles one of them).
func spellings(word string) []string {
	w := strings.ToLower(strings.TrimSpace(word))
	if w == "" {
		return nil
	}
	out := []string{w}
	if _, rest := domain.SplitArticle(w); rest != w && rest != "" {
		out = append(out, rest)
	}
	return out
}

// uniqueFolderName: name, else "name (2)", "name (3)", … — case-insensitive against taken, and
// cut so the result still fits the folder name limit.
func uniqueFolderName(name string, taken []string) string {
	used := make(map[string]bool, len(taken))
	for _, n := range taken {
		used[strings.ToLower(n)] = true
	}
	if !used[strings.ToLower(name)] {
		return name
	}
	for i := 2; ; i++ {
		suffix := fmt.Sprintf(" (%d)", i)
		base := []rune(name)
		if len(base)+len([]rune(suffix)) > maxFolderName {
			base = base[:maxFolderName-len([]rune(suffix))]
		}
		if cand := string(base) + suffix; !used[strings.ToLower(cand)] {
			return cand
		}
	}
}

// ImportShared copies a shared folder into callerID's account, in ONE transaction: a new folder
// (imported_from = the source) plus a copy of every word the caller does not have yet — context,
// card, the word_translations rows. Progress is NOT copied: the words start fresh in box 1. No AI
// is involved. Any failure rolls everything back, including the new folder.
func (r *FolderRepository) ImportShared(ctx context.Context, callerID uuid.UUID, callerLang, token string, maxFolders int) (*domain.ImportResult, error) {
	var res domain.ImportResult
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		var srcID, ownerID uuid.UUID
		var name, color, lang string
		err := tx.QueryRow(ctx, `
			SELECT f.id, f.user_id, f.name, f.color, u.learning_language
			FROM folders f JOIN users u ON u.id = f.user_id
			WHERE f.share_token = $1`, token).Scan(&srcID, &ownerID, &name, &color, &lang)
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrNotFound
		}
		if err != nil {
			return err
		}
		if ownerID == callerID {
			return &domain.OwnFolderError{FolderID: srcID}
		}
		if lang != callerLang {
			return domain.ErrLangMismatch
		}

		rows, err := tx.Query(ctx, `SELECT name FROM folders WHERE user_id = $1`, callerID)
		if err != nil {
			return err
		}
		taken, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		if len(taken) >= maxFolders {
			return fmt.Errorf("%w: too many folders", domain.ErrValidation)
		}

		res.FolderID = uuid.New()
		if _, err := tx.Exec(ctx, `
			INSERT INTO folders (id, user_id, name, color, imported_from) VALUES ($1, $2, $3, $4, $5)`,
			res.FolderID, callerID, uniqueFolderName(name, taken), color, srcID); err != nil {
			return err
		}

		// What the caller already has, in both spellings.
		rows, err = tx.Query(ctx, `SELECT word FROM word_cards WHERE user_id = $1`, callerID)
		if err != nil {
			return err
		}
		have := map[string]bool{}
		mine, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		for _, w := range mine {
			for _, s := range spellings(w) {
				have[s] = true
			}
		}

		type src struct {
			id                                         uuid.UUID
			word, translation, transcription, language string
			audioURL                                   *string
			exampleSentence, exampleTranslation        string
			lemma, article, plural, partOfSpeech       *string
			translationLanguage                        *string
			exampleTranslationLanguage                 *string
		}
		rows, err = tx.Query(ctx, `
			SELECT id, word, translation, transcription, audio_url, language,
			       COALESCE(example_sentence, ''), COALESCE(example_translation, ''),
			       lemma, article, plural, part_of_speech, translation_language, example_translation_language
			FROM word_cards WHERE folder_id = $1
			ORDER BY created_at, id LIMIT $2`, srcID, domain.MaxSharedWords)
		if err != nil {
			return err
		}
		words, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (src, error) {
			var s src
			err := row.Scan(&s.id, &s.word, &s.translation, &s.transcription, &s.audioURL, &s.language,
				&s.exampleSentence, &s.exampleTranslation, &s.lemma, &s.article, &s.plural, &s.partOfSpeech, &s.translationLanguage, &s.exampleTranslationLanguage)
			return s, err
		})
		if err != nil {
			return err
		}

		now := time.Now().UTC()
		for i, s := range words {
			forms := spellings(s.word)
			// A source card with no translation (old data) is not copied: it could not be asked as a question.
			dup := len(forms) == 0 || strings.TrimSpace(s.translation) == ""
			for _, f := range forms {
				dup = dup || have[f]
			}
			if dup {
				res.Skipped++
				continue
			}
			for _, f := range forms {
				have[f] = true // the same word twice in the source is added once
			}
			ctxID, cardID := uuid.New(), uuid.New()
			created := now.Add(time.Duration(i) * time.Microsecond) // keeps the source order
			if _, err := tx.Exec(ctx, `
				INSERT INTO contexts (id, user_id, source_text, language, created_at, meaning)
				VALUES ($1, $2, $3, $4, $5, $6)`,
				ctxID, callerID, s.word, s.language, created, s.translation); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO word_cards
				  (id, context_id, user_id, word, translation, transcription, audio_url, language, created_at,
				   example_sentence, example_translation, folder_id, lemma, article, plural, part_of_speech, translation_language,
				   example_translation_language)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
				cardID, ctxID, callerID, s.word, s.translation, s.transcription, s.audioURL, s.language, created,
				s.exampleSentence, s.exampleTranslation, res.FolderID, s.lemma, s.article, s.plural, s.partOfSpeech, s.translationLanguage,
				s.exampleTranslationLanguage); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO word_translations (word_id, language, translation, example_translation)
				SELECT $2, language, translation, example_translation FROM word_translations WHERE word_id = $1`,
				s.id, cardID); err != nil {
				return err
			}
			// The translation is in the source's language (copied as is), so training finds it
			// under that language even if the source's cache lacked the row.
			if s.translationLanguage != nil && strings.TrimSpace(s.translation) != "" {
				if _, err := tx.Exec(ctx, `
					INSERT INTO word_translations (word_id, language, translation, example_translation)
					VALUES ($1, $2, $3, $4)
					ON CONFLICT (word_id, language) DO UPDATE
					SET translation = EXCLUDED.translation, example_translation = EXCLUDED.example_translation`,
					cardID, *s.translationLanguage, s.translation, importedExample(s.exampleTranslation, s.exampleTranslationLanguage, *s.translationLanguage)); err != nil {
					return err
				}
			}
			res.Added++
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO folder_imports (folder_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, srcID, callerID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return &res, nil
}

// importedExample: the example translation for the cache entry of the card's own translation language
// — only when it is written in that language (a Russian example next to a Uzbek word stays out).
func importedExample(example string, exampleLang *string, translationLang string) string {
	if exampleLang != nil && *exampleLang != translationLang {
		return ""
	}
	return example
}
