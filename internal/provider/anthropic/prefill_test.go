package anthropic

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSupportsPrefill(t *testing.T) {
	for model, want := range map[string]bool{
		"claude-haiku-4-5":           true,
		"claude-haiku-4-5-20251001":  true,
		"claude-sonnet-4-5":          true,
		"claude-sonnet-4-5-20250929": true,
		"claude-opus-4-1-20250805":   true,
		"claude-opus-4-1":            true,
		"claude-sonnet-4-20250514":   true,
		"claude-opus-4-0":            true,
		"claude-3-5-sonnet-20241022": true,
		"claude-3-haiku-20240307":    true,
		"claude-sonnet-4-6":          false,
		"claude-opus-4-6":            false,
		"claude-opus-4-10":           false,
		"claude-sonnet-5-5":          false,
		"claude-opus-5-5":            false,
		"claude-fable-5-1":           false,
		"something-unknown":          false,
		"":                           false,
	} {
		if got := supportsPrefill(model); got != want {
			t.Errorf("supportsPrefill(%q) = %v, want %v", model, got, want)
		}
	}
}

// fakeAPI answers every call with answer and records the request body.
func fakeAPI(t *testing.T, answer string) (sent *struct{ Messages []struct{ Role string } }) {
	t.Helper()
	sent = &struct{ Messages []struct{ Role string } }{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, sent)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"content": []map[string]string{{"type": "text", "text": answer}}, "stop_reason": "end_turn",
		})
	}))
	old := endpoint
	endpoint = srv.URL
	t.Cleanup(func() { endpoint = old; srv.Close() })
	return sent
}

func TestCompleteMessages_PrefillOnlyForModelsThatTakeIt(t *testing.T) {
	c := New("key", "")
	for _, tc := range []struct {
		model    string
		wantRole []string
		wantText string
	}{
		{"claude-haiku-4-5", []string{"user", "assistant"}, `{"a":1}`}, // the prefill "{" is put back in front
		{"claude-sonnet-4-6", []string{"user"}, `"a":1}`},              // nothing prepended
	} {
		sent := fakeAPI(t, `"a":1}`)
		got, err := c.completeWith(context.Background(), tc.model, "hi", searchPrefill, 100, 5*time.Second)
		if err != nil {
			t.Fatal(err)
		}
		var roles []string
		for _, m := range sent.Messages {
			roles = append(roles, m.Role)
		}
		if len(roles) != len(tc.wantRole) || (len(roles) == 2 && roles[1] != "assistant") {
			t.Errorf("%s: roles %v, want %v", tc.model, roles, tc.wantRole)
		}
		if got != tc.wantText {
			t.Errorf("%s: text %q, want %q", tc.model, got, tc.wantText)
		}
	}
}

func TestParsers_AcceptPlainFencedAndChattyAnswers(t *testing.T) {
	photo := `{"words":[{"word":"Hund","article":"der","word_type":"noun","translation":"собака"}]}`
	check := `{"status":"ok","input":"Hund","lemma":"Hund","article":"der","plural":"Hunde","part_of_speech":"noun","translation":"собака","reason":""}`
	proof := `{"title":"T","text":"Der Hund läuft.","corrections":[],"words":[]}`
	wrap := map[string]func(string) string{
		"plain":      func(s string) string { return s },
		"fenced":     func(s string) string { return "```json\n" + s + "\n```" },
		"text first": func(s string) string { return "Here is the result:\n" + s + "\nHope it helps!" },
	}
	for name, w := range wrap {
		if got, err := parsePhotoWords(w(photo)); err != nil || len(got.Words) != 1 || got.Words[0].Word != "Hund" {
			t.Errorf("photo/%s: %v %v", name, got, err)
		}
		if got, err := parseWordCheck(w(check)); err != nil || got.Lemma != "Hund" {
			t.Errorf("word check/%s: %+v %v", name, got, err)
		}
		if got, err := parseProofread(w(proof)); err != nil || got.Text != "Der Hund läuft." {
			t.Errorf("proofread/%s: %+v %v", name, got, err)
		}
	}
}
