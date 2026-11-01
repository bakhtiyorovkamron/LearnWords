package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/auth"
	"learnwords/internal/domain"
	"learnwords/internal/service"
	"learnwords/migrations"
)

type starterFixture struct {
	moveFixture
	svc     *service.StarterService
	review  *ReviewRepository
	reviews *service.ReviewService
	folders *FolderRepository
}

func newStarterFixture(t *testing.T) starterFixture {
	f := newMoveFixture(t)
	svc, err := service.NewStarterService(NewContextRepository(f.pool))
	if err != nil {
		t.Fatal(err)
	}
	review := NewReviewRepository(f.pool)
	return starterFixture{f, svc, review, service.NewReviewService(review), NewFolderRepository(f.pool)}
}

func (f starterFixture) create(t *testing.T, lang, native string) uuid.UUID {
	t.Helper()
	ctx := domain.WithTranslationLang(context.Background(), native)
	if err := f.svc.Create(ctx, f.user, lang); err != nil {
		t.Fatal(err)
	}
	var id uuid.UUID
	if err := f.pool.QueryRow(ctx, `SELECT id FROM folders WHERE user_id = $1`, f.user).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

var today = func() time.Time { return time.Now().UTC().Truncate(24 * time.Hour) }

func TestStarter_Registration_DeUz_OneFolderFifteenPausedCards(t *testing.T) {
	pool := testPool(t)
	users := NewUserRepository(pool)
	svc, err := service.NewStarterService(NewContextRepository(pool))
	if err != nil {
		t.Fatal(err)
	}
	authSvc := service.NewAuthService(users, auth.NewTokenManager("secret-secret-secret-secret-1234", "test", time.Minute, time.Hour))
	authSvc.SetStarter(svc)

	email := uuid.NewString() + "@example.com"
	ctx := domain.WithTranslationLang(context.Background(), "uz")
	u, _, err := authSvc.Register(ctx, email, "password123", "de")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, u.ID) }) //nolint:errcheck

	list, err := NewFolderRepository(pool).List(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Folders) != 1 || list.Folders[0].Name != "Tanishuv" || list.Folders[0].Total != 15 {
		t.Fatalf("folders: %+v", list.Folders)
	}
	var word, translation, example, trLang, exLang, pos string
	var paused bool
	err = pool.QueryRow(ctx, `
		SELECT word, translation, example_sentence, translation_language, example_translation_language, part_of_speech, paused
		FROM word_cards WHERE user_id = $1 ORDER BY created_at, id LIMIT 1`, u.ID).
		Scan(&word, &translation, &example, &trLang, &exLang, &pos, &paused)
	if err != nil {
		t.Fatal(err)
	}
	if word != "Hallo!" || translation != "Salom!" || example != "___ Ich heiße Anna." || trLang != "uz" || exLang != "uz" || pos != "phrase" || !paused {
		t.Errorf("first card: %q %q %q %q %q %q paused=%v", word, translation, example, trLang, exLang, pos, paused)
	}
	var unpaused, withLemma, contexts int
	pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE NOT paused), count(*) FILTER (WHERE lemma IS NOT NULL OR article IS NOT NULL) FROM word_cards WHERE user_id = $1`, u.ID).Scan(&unpaused, &withLemma) //nolint:errcheck
	pool.QueryRow(ctx, `SELECT count(*) FROM contexts WHERE user_id = $1`, u.ID).Scan(&contexts)                                                                                                           //nolint:errcheck
	if unpaused != 0 || withLemma != 0 || contexts != 15 {
		t.Errorf("unpaused %d, with grammar %d, contexts %d", unpaused, withLemma, contexts)
	}
	// the Collection (status "new") and the word's own translation row are there
	var tr int
	pool.QueryRow(ctx, `SELECT count(*) FROM word_translations t JOIN word_cards w ON w.id = t.word_id WHERE w.user_id = $1 AND t.language = 'uz'`, u.ID).Scan(&tr) //nolint:errcheck
	if tr != 15 {
		t.Errorf("%d uz translation rows, want 15", tr)
	}
}

func TestStarter_Korean_HasTranscription_UnknownLanguageIsRussian(t *testing.T) {
	f := newStarterFixture(t)
	f.create(t, "ko", "ru")
	var tr, trLang string
	if err := f.pool.QueryRow(context.Background(),
		`SELECT transcription, translation_language FROM word_cards WHERE user_id = $1 ORDER BY created_at LIMIT 1`, f.user).Scan(&tr, &trLang); err != nil {
		t.Fatal(err)
	}
	if tr == "" || trLang != "ru" {
		t.Errorf("transcription %q, translation language %q", tr, trLang)
	}
	// an unknown interface language (WithTranslationLang normalizes it) → ru
	g := newStarterFixture(t)
	g.create(t, "en", "xx")
	var name string
	g.pool.QueryRow(context.Background(), `SELECT name FROM folders WHERE user_id = $1`, g.user).Scan(&name) //nolint:errcheck
	if name != "Знакомство" {
		t.Errorf("folder %q", name)
	}
}

func TestPaused_StayOutOfTheGeneralQueue_ButTheFolderTrainsThem(t *testing.T) {
	f := newStarterFixture(t)
	ctx := context.Background()
	folder := f.create(t, "de", "ru")
	day := today()

	if n, _ := f.review.CountDue(ctx, f.user, day, nil); n != 0 {
		t.Errorf("general CountDue = %d, want 0", n)
	}
	if cards, _ := f.review.ListDue(ctx, f.user, day, 100, nil); len(cards) != 0 {
		t.Errorf("general ListDue = %d cards", len(cards))
	}
	if n, _ := f.review.CountDue(ctx, f.user, day, &domain.FolderFilter{None: true}); n != 0 {
		t.Errorf("the \"no folder\" filter counted %d", n)
	}
	own := &domain.FolderFilter{ID: folder}
	if n, _ := f.review.CountDue(ctx, f.user, day, own); n != 15 {
		t.Errorf("the folder's CountDue = %d, want 15", n)
	}
	cards, err := f.review.ListDue(ctx, f.user, day, 100, own)
	if err != nil || len(cards) != 15 || cards[0].Word != "Hallo!" {
		t.Fatalf("the folder's ListDue = %d cards (%v)", len(cards), err)
	}

	// Practice works on them and does not unpause.
	if words, _ := f.review.PracticeWords(ctx, f.user, "recent", 50, nil); len(words) != 15 {
		t.Errorf("practice offers %d words, want 15", len(words))
	}
	if err := f.reviews.AnswerPractice(ctx, f.user, cards[1].ID, true); err != nil {
		t.Fatal(err)
	}
	if n := f.count(t, `SELECT count(*) FROM word_cards WHERE user_id = $1 AND NOT paused`, f.user); n != 0 {
		t.Errorf("practice unpaused %d cards", n)
	}

	// The first review answer unpauses that card — and only that card.
	if _, err := f.reviews.Answer(ctx, f.user, cards[0].ID, true); err != nil {
		t.Fatal(err)
	}
	if n := f.count(t, `SELECT count(*) FROM word_cards WHERE user_id = $1 AND NOT paused`, f.user); n != 1 {
		t.Fatalf("%d unpaused cards, want 1", n)
	}
	if n, _ := f.review.CountDue(ctx, f.user, day, nil); n != 0 {
		t.Errorf("it is not due until tomorrow, yet the general count is %d", n)
	}
	// ...and from then on it follows the normal schedule: due again → in the general queue.
	f.exec(t, `UPDATE word_progress SET next_review_at = $2::date WHERE word_id = $1`, cards[0].ID, day)
	if n, _ := f.review.CountDue(ctx, f.user, day, nil); n != 1 {
		t.Errorf("an unpaused due card: general CountDue = %d, want 1", n)
	}
	got, _ := f.review.ListDue(ctx, f.user, day, 100, nil)
	if len(got) != 1 || got[0].ID != cards[0].ID {
		t.Errorf("general ListDue = %+v", got)
	}
	// the other 14 are still paused
	if n, _ := f.review.CountDue(ctx, f.user, day, own); n != 14+1 {
		t.Errorf("the folder still has %d due, want 15", n)
	}
}

func TestPaused_FoldersListAndHeroAndGoal(t *testing.T) {
	f := newStarterFixture(t)
	ctx := context.Background()
	folder := f.create(t, "en", "en")

	list, err := f.folders.List(ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	if list.All.DueToday != 0 || list.All.Total != 15 {
		t.Errorf("all: due %d total %d, want 0 / 15", list.All.DueToday, list.All.Total)
	}
	if len(list.Folders) != 1 || list.Folders[0].ID != folder || list.Folders[0].DueToday != 15 {
		t.Errorf("the starter folder's own due_today: %+v", list.Folders)
	}
	if n, err := NewHeroRepository(f.pool).CountDueToday(ctx, f.user, today()); err != nil || n != 0 {
		t.Errorf("hero due count = %d (%v), want 0", n, err)
	}

	// The daily goal's queue ignores them: answering the one real due word reaches the goal at once.
	word := uuid.New()
	ctxID := uuid.New()
	f.exec(t, `INSERT INTO contexts (id, user_id, source_text) VALUES ($1, $2, 'x')`, ctxID, f.user)
	f.exec(t, `INSERT INTO word_cards (id, context_id, user_id, word, translation) VALUES ($1, $2, $3, 'real', 'x')`, word, ctxID, f.user)
	if _, err := f.reviews.Answer(ctx, f.user, word, true); err != nil {
		t.Fatal(err)
	}
	if n := f.count(t, `SELECT count(*) FROM goal_days WHERE user_id = $1`, f.user); n != 1 {
		t.Errorf("goal days = %d: the 15 paused words must not count as still due", n)
	}
}

func TestMigration41_UpAndDown(t *testing.T) {
	f := newStarterFixture(t)
	read := func(name string) string {
		b, err := migrations.FS.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		return string(b)
	}
	f.exec(t, read("000041_word_paused.up.sql")) // idempotent
	f.exec(t, read("000041_word_paused.down.sql"))
	if n := f.count(t, `SELECT count(*) FROM information_schema.columns WHERE table_name = 'word_cards' AND column_name = 'paused'`); n != 0 {
		t.Error("down left the column")
	}
	f.exec(t, read("000041_word_paused.up.sql"))
	if n := f.count(t, `SELECT count(*) FROM information_schema.columns WHERE table_name = 'word_cards' AND column_name = 'paused' AND column_default = 'false'`); n != 1 {
		t.Error("up did not restore the column with its default")
	}
}
