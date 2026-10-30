package domain

import (
	"errors"
	"strings"
	"testing"
)

func TestNewPushPayload(t *testing.T) {
	ok, err := NewPushPayload("  Time to learn  ", " 5 words are waiting ", "")
	if err != nil || ok != (PushPayload{Title: "Time to learn", Body: "5 words are waiting", URL: "/cards"}) {
		t.Fatalf("defaults: %+v %v", ok, err)
	}
	for _, u := range []string{"/stats", "/cards?tab=all&folder=x", "/story#today", "/"} {
		if p, err := NewPushPayload("t", "b", u); err != nil || p.URL != u {
			t.Errorf("url %q: %+v %v", u, p, err)
		}
	}

	bad := map[string][3]string{
		"empty title":       {"", "b", ""},
		"blank title":       {"   ", "b", ""},
		"title 61":          {strings.Repeat("я", 61), "b", ""},
		"empty body":        {"t", "", ""},
		"body 201":          {"t", strings.Repeat("я", 201), ""},
		"scheme":            {"t", "b", "https://evil"},
		"scheme, no slash":  {"t", "b", "javascript:alert(1)"},
		"protocol-relative": {"t", "b", "//evil"},
		"backslash":         {"t", "b", `/\evil`},
		"no leading slash":  {"t", "b", "cards"},
		"newline":           {"t", "b", "/cards\nSet-Cookie: x"},
		"too long":          {"t", "b", "/" + strings.Repeat("a", 500)},
	}
	for name, in := range bad {
		if _, err := NewPushPayload(in[0], in[1], in[2]); !errors.Is(err, ErrValidation) {
			t.Errorf("%s: %v", name, err)
		}
	}
	// the limits themselves are fine, counted in characters not bytes
	if _, err := NewPushPayload(strings.Repeat("я", 60), strings.Repeat("я", 200), ""); err != nil {
		t.Errorf("60/200 characters: %v", err)
	}
}
