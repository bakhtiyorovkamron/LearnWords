package postgres

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"learnwords/internal/domain"
)

// UpdateContent edits a card's text fields and/or folder; nil fields stay unchanged. Returns the
// card in the shape of a GET /api/collection item (card + Leitner progress), so a client can drop
// it straight into its lists. Progress (word_progress) is deliberately not touched. Empty example
// texts are valid (” is stored).
//
// Training reads translations from word_translations, so the cache follows the edit (all in one
// transaction):
//   - the translation or its example translation changed → the card's translation_language
//     becomes the current interface language (domain.TranslationLangFrom), the cache entry for it
//     is the new text, and the entries for every other language are dropped (regenerated from the
//     new meaning);
//   - the word or the example sentence changed → every cached translation of the word is dropped.
func (r *WordCardRepository) UpdateContent(ctx context.Context, userID, id uuid.UUID, u domain.WordCardUpdate) (*domain.CollectionCard, error) {
	now := time.Now().UTC()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	uiLang := domain.TranslationLangFrom(ctx)
	var c domain.CollectionCard
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		var oldWord, oldTr, oldEx, oldExTr string
		err := tx.QueryRow(ctx, `
			SELECT word, translation, COALESCE(example_sentence, ''), COALESCE(example_translation, '')
			FROM word_cards WHERE id = $1 AND user_id = $2 FOR UPDATE`, id, userID).Scan(&oldWord, &oldTr, &oldEx, &oldExTr)
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrNotFound // not found or belongs to another user
		}
		if err != nil {
			return err
		}
		differs := func(p *string, old string) bool { return p != nil && *p != old }
		exampleChanged := differs(u.ExampleTranslation, oldExTr)
		meaningChanged := differs(u.Translation, oldTr) || exampleChanged
		// A changed example translation was written now, in the current interface language.
		var newExLang *string
		if exampleChanged && strings.TrimSpace(*u.ExampleTranslation) != "" {
			newExLang = &uiLang
		}
		textChanged := differs(u.Word, oldWord) || differs(u.ExampleSentence, oldEx)

		err = tx.QueryRow(ctx, `
			WITH u AS (
				UPDATE word_cards SET
				  word                = COALESCE($3, word),
				  translation         = COALESCE($4, translation),
				  transcription       = COALESCE($5, transcription),
				  example_sentence    = COALESCE($6, example_sentence),
				  example_translation = COALESCE($7, example_translation),
				  -- only a folder of the same user can be assigned (otherwise it becomes NULL)
				  folder_id           = CASE WHEN $8 THEN (SELECT f.id FROM folders f WHERE f.id = $9 AND f.user_id = $2)
				                             ELSE folder_id END,
				  translation_language = CASE WHEN $11 THEN $12 ELSE translation_language END,
				  example_translation_language = CASE WHEN $13 THEN $14 ELSE example_translation_language END
				WHERE id = $1 AND user_id = $2
				RETURNING id, context_id, user_id, word, translation, transcription, audio_url, language, created_at,
				          example_sentence, example_translation, folder_id, lemma, article, plural, part_of_speech,
				          translation_language, example_translation_language
			)
			SELECT u.id, u.context_id, u.user_id, u.word, u.translation, u.transcription, u.audio_url, u.language, u.created_at,
			       COALESCE(u.example_sentence, ''), COALESCE(u.example_translation, ''), u.folder_id,
			       u.lemma, u.article, u.plural, u.part_of_speech, u.translation_language, u.example_translation_language,
			       COALESCE(p.box_level, 1), COALESCE(p.is_learned, false),
			       COALESCE(p.next_review_at, $10::date)::timestamp,
			       COALESCE(p.last_reviewed_at >= $10::date::timestamp AT TIME ZONE 'UTC', false)
			FROM u LEFT JOIN word_progress p ON p.word_id = u.id`,
			id, userID, u.Word, u.Translation, u.Transcription, u.ExampleSentence, u.ExampleTranslation,
			u.SetFolder, u.Folder, today, meaningChanged, uiLang, exampleChanged, newExLang).Scan(
			&c.ID, &c.ContextID, &c.UserID, &c.Word, &c.Translation, &c.Transcription, &c.AudioURL, &c.Language, &c.CreatedAt,
			&c.ExampleSentence, &c.ExampleTranslation, &c.FolderID,
			&c.Lemma, &c.Article, &c.Plural, &c.PartOfSpeech, &c.TranslationLanguage, &c.ExampleTranslationLanguage,
			&c.BoxLevel, &c.IsLearned, &c.NextReviewAt, &c.ReviewedToday)
		if err != nil {
			return err
		}

		if textChanged {
			if _, err := tx.Exec(ctx, `DELETE FROM word_translations WHERE word_id = $1`, id); err != nil {
				return err
			}
		}
		if meaningChanged {
			return replaceTranslationCache(ctx, tx, id, uiLang, c.Translation, c.ExampleTranslation)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &c, nil
}
