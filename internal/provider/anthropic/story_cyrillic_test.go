package anthropic

import "testing"

// Offline: detects the model slipping into Russian instead of writing purely in the learning
// language — the trigger for GenerateStory's retry-then-error path.
func TestContainsCyrillic(t *testing.T) {
	cases := []struct {
		s    string
		want bool
	}{
		{"Hallo, wie geht es dir?", false},
		{"I eat an apple every day.", false},
		{"안녕하세요, 오늘 뭐 해요?", false},
		{"Привет, как дела?", true},
		{"Hallo! Das war ein спокойный Tag.", true}, // a single stray Russian word is enough
		{"", false},
	}
	for _, tc := range cases {
		if got := containsCyrillic(tc.s); got != tc.want {
			t.Errorf("containsCyrillic(%q) = %v, want %v", tc.s, got, tc.want)
		}
	}
}
