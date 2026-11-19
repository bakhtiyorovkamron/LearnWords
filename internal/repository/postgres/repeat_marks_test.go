package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

type repeatFixture struct {
	goalFixture
	repeat *service.RepeatService
	cards  *WordCardRepository
	today  time.Time
}

func newRepeatFixture(t *testing.T) repeatFixture {
	f := newGoalFixture(t)
	now := time.Now().UTC()
	return repeatFixture{f, service.NewRepeatService(f.repo), NewWordCardRepository(f.pool),
		time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)}
}

// scheduled gives the word a progress row: box, next review in `days`, learned or not.
func (f repeatFixture) scheduled(t *testing.T, id uuid.UUID, box, days int, learned bool) {
	f.exec(t, `INSERT INTO word_progress (word_id, user_id, box_level, next_review_at, is_learned) VALUES ($1, $2, $3, $4, $5)`,
		id, f.user, box, f.today.AddDate(0, 0, days), learned)
}

func (f repeatFixture) mark(t *testing.T, id uuid.UUID, on bool) {
	t.Helper()
	if _, err := f.repeat.SetRepeat(context.Background(), f.user, id, on); err != nil {
		t.Fatal(err)
	}
}

type progressState struct {
	next    time.Time
	learned bool
	box     int
	paused  bool
}

func (f repeatFixture) state(t *testing.T, id uuid.UUID) progressState {
	t.Helper()
	var s progressState
	if err := f.pool.QueryRow(context.Background(),
		`SELECT p.next_review_at, p.is_learned, p.box_level, w.paused FROM word_cards w JOIN word_progress p ON p.word_id = w.id WHERE w.id = $1`, id).
		Scan(&s.next, &s.learned, &s.box, &s.paused); err != nil {
		t.Fatal(err)
	}
	return s
}

func (f repeatFixture) due(t *testing.T) []uuid.UUID {
	t.Helper()
	cards, err := f.repo.ListDue(context.Background(), f.user, f.today, 100, nil)
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]uuid.UUID, len(cards))
	for i, c := range cards {
		ids[i] = c.ID
	}
	return ids
}

func (f repeatFixture) marks(t *testing.T, id uuid.UUID) int {
	return f.count(t, `SELECT count(*) FROM word_repeat_marks WHERE word_id = $1`, id)
}

func TestRepeatMark_MakesDueTodayAndFirst(t *testing.T) {
	f := newRepeatFixture(t)
	ids := f.words(t, 3) // unreviewed: due today
	later := ids[2]
	f.scheduled(t, later, 3, 10, false)
	if n, _ := f.repo.CountDue(context.Background(), f.user, f.today, nil); n != 2 {
		t.Fatalf("before: CountDue = %d, want 2", n)
	}

	f.mark(t, later, true)
	s := f.state(t, later)
	if !s.next.Equal(f.today) || s.box != 3 {
		t.Errorf("marked: next %v box %d, want today and box 3", s.next, s.box)
	}
	if n, _ := f.repo.CountDue(context.Background(), f.user, f.today, nil); n != 3 {
		t.Errorf("CountDue = %d, want 3", n)
	}
	if due := f.due(t); len(due) != 3 || due[0] != later {
		t.Errorf("ListDue = %v, want the marked word first", due)
	}

	// The newest mark comes first.
	f.mark(t, ids[1], true)
	if due := f.due(t); due[0] != ids[1] || due[1] != later {
		t.Errorf("ListDue = %v, want the newest mark first", due)
	}
}

func TestRepeatMark_LearnedAndPausedWordsComeIn(t *testing.T) {
	f := newRepeatFixture(t)
	ids := f.words(t, 2)
	learned, starter := ids[0], ids[1]
	f.scheduled(t, learned, 5, 30, true)
	f.exec(t, `UPDATE word_cards SET paused = true WHERE id = $1`, starter) // a starter word: no progress row
	if due := f.due(t); len(due) != 0 {
		t.Fatalf("before: ListDue = %v, want none", due)
	}

	f.mark(t, learned, true)
	f.mark(t, starter, true)
	due := f.due(t)
	if len(due) != 2 {
		t.Fatalf("ListDue = %v, want both", due)
	}
	if s := f.state(t, learned); s.learned || s.box != 5 {
		t.Errorf("learned word: learned %v box %d, want not learned, box 5 untouched", s.learned, s.box)
	}
	if n := f.count(t, `SELECT count(*) FROM word_progress WHERE word_id = $1`, starter); n != 0 {
		t.Errorf("the starter word got a progress row")
	}
	if n := f.count(t, `SELECT count(*) FROM word_cards WHERE id = $1 AND paused`, starter); n != 0 {
		t.Errorf("the starter word is still paused")
	}
}

func TestRepeatMark_TwiceKeepsTheFirstValues_UnmarkRestoresExactly(t *testing.T) {
	f := newRepeatFixture(t)
	id := f.words(t, 1)[0]
	f.scheduled(t, id, 5, 30, true)
	f.exec(t, `UPDATE word_cards SET paused = true WHERE id = $1`, id)
	before := f.state(t, id)

	f.mark(t, id, true)
	f.mark(t, id, true) // a no-op: must not store "today / not learned / not paused" as the old values
	if n := f.marks(t, id); n != 1 {
		t.Fatalf("%d marks, want 1", n)
	}

	f.mark(t, id, false)
	if after := f.state(t, id); after != before {
		t.Errorf("after unmark %+v, want %+v", after, before)
	}
	if n := f.marks(t, id); n != 0 {
		t.Errorf("the mark is still there")
	}
	f.mark(t, id, false) // no mark: nothing changes
	if after := f.state(t, id); after != before {
		t.Errorf("a second unmark changed %+v", after)
	}
}

func TestRepeatMark_UnmarkRestoresOnlyWhatChanged(t *testing.T) {
	f := newRepeatFixture(t)
	ids := f.words(t, 2)
	overdue, fresh := ids[0], ids[1]
	f.scheduled(t, overdue, 2, -3, false) // overdue already: LEAST keeps its date
	f.mark(t, overdue, true)
	f.mark(t, fresh, true) // no progress row at all
	var prevNext *time.Time
	var prevLearned *bool
	if err := f.pool.QueryRow(context.Background(),
		`SELECT prev_next_review_at, prev_is_learned FROM word_repeat_marks WHERE word_id = $1`, overdue).Scan(&prevNext, &prevLearned); err != nil {
		t.Fatal(err)
	}
	if prevNext != nil || prevLearned != nil {
		t.Errorf("nothing changed, yet stored next %v learned %v", prevNext, prevLearned)
	}
	f.mark(t, overdue, false)
	f.mark(t, fresh, false)
	if s := f.state(t, overdue); !s.next.Equal(f.today.AddDate(0, 0, -3)) {
		t.Errorf("overdue word now due %v", s.next)
	}
	if n := f.count(t, `SELECT count(*) FROM word_progress WHERE word_id = $1`, fresh); n != 0 {
		t.Errorf("unmark created a progress row")
	}
}

func TestRepeatMark_ReviewAnswerClearsIt_PracticeDoesNot(t *testing.T) {
	f := newRepeatFixture(t)
	ids := f.words(t, 2)
	reviewed, practised := ids[0], ids[1]
	f.scheduled(t, reviewed, 3, 10, false)
	f.scheduled(t, practised, 3, 10, false)
	f.mark(t, reviewed, true)
	f.mark(t, practised, true)

	if err := f.review.AnswerPractice(context.Background(), f.user, practised, true); err != nil {
		t.Fatal(err)
	}
	if n := f.marks(t, practised); n != 1 {
		t.Errorf("a practice answer cleared the mark")
	}

	f.answer(t, reviewed, true) // the normal Leitner answer: box 3 → 4
	if n := f.marks(t, reviewed); n != 0 {
		t.Fatalf("a review answer kept the mark")
	}
	answered := f.state(t, reviewed)
	if answered.box != 4 || !answered.next.After(f.today) {
		t.Errorf("after the answer: box %d next %v", answered.box, answered.next)
	}
	f.mark(t, reviewed, false) // the mark is gone: the newer answer stays
	if after := f.state(t, reviewed); after != answered {
		t.Errorf("unmark after the answer changed %+v → %+v", answered, after)
	}
}

func TestRepeatMark_PracticeHardPutsMarkedFirst(t *testing.T) {
	f := newRepeatFixture(t)
	ids := f.words(t, 3)
	f.scheduled(t, ids[2], 5, 30, false) // the easiest: box 5
	f.mark(t, ids[2], true)
	cards, err := f.repo.PracticeWords(context.Background(), f.user, "hard", 10, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(cards) != 3 || cards[0].ID != ids[2] {
		t.Errorf("practice hard starts with %v, want the marked word", cards[0].ID)
	}
}

func TestRepeatMark_CollectionSortRepeat(t *testing.T) {
	f := newRepeatFixture(t)
	ctx := context.Background()
	ids := f.words(t, 4)
	f.mark(t, ids[1], true)
	f.exec(t, `UPDATE word_repeat_marks SET marked_at = now() - interval '1 hour' WHERE word_id = $1`, ids[1])
	opened := time.Now().Add(-30 * time.Minute) // the deck was opened after that mark …
	f.mark(t, ids[0], true)                     // … and this one, the oldest word, while it was open

	list := func(before time.Time) []domain.CollectionCard {
		items, total, err := f.cards.ListCollection(ctx, f.user, domain.CollectionFilter{Sort: "repeat", MarksBefore: before, Limit: 10})
		if err != nil || total != 4 {
			t.Fatalf("ListCollection: %d (%v)", total, err)
		}
		return items
	}
	// The older mark first, then by created_at DESC: the newer mark stays in its place, the last one.
	items := list(opened)
	got := []uuid.UUID{items[0].ID, items[1].ID, items[2].ID, items[3].ID}
	if want := []uuid.UUID{ids[1], ids[3], ids[2], ids[0]}; got[0] != want[0] || got[1] != want[1] || got[2] != want[2] || got[3] != want[3] {
		t.Errorf("order %v, want %v", got, want)
	}
	if !items[0].RepeatMarked || !items[3].RepeatMarked || items[1].RepeatMarked {
		t.Errorf("repeat_marked: %v %v %v", items[0].RepeatMarked, items[1].RepeatMarked, items[3].RepeatMarked)
	}
	if items := list(time.Now()); items[0].ID != ids[0] || items[1].ID != ids[1] {
		t.Errorf("with every mark counted: %v, %v; want the newest mark first", items[0].ID, items[1].ID)
	}
	if plain, _, _ := f.cards.ListCollection(ctx, f.user, domain.CollectionFilter{Limit: 10}); len(plain) != 4 {
		t.Errorf("the default sort lost words: %d", len(plain))
	}
	if ids2, _, err := f.cards.ListCollectionIDs(ctx, f.user, domain.CollectionFilter{Sort: "repeat", MarksBefore: opened, Limit: 10}); err != nil || ids2[0] != ids[1] {
		t.Errorf("ListCollectionIDs sort=repeat: %v (%v)", ids2, err)
	}
}

func TestRepeatMark_AnotherUsersWord(t *testing.T) {
	f := newRepeatFixture(t)
	id := f.words(t, 1)[0]
	other := uuid.New()
	f.exec(t, `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'x')`, other, other.String()+"@test")
	t.Cleanup(func() { f.pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, other) }) //nolint:errcheck
	for _, on := range []bool{true, false} {
		if _, err := f.repeat.SetRepeat(context.Background(), other, id, on); err != domain.ErrNotFound {
			t.Errorf("marked=%v by another user: %v, want ErrNotFound", on, err)
		}
	}
	if n := f.marks(t, id); n != 0 {
		t.Errorf("another user marked the word")
	}
}
