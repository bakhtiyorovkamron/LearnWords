package domain

import (
	"errors"
	"strings"
	"testing"
)

func TestNewPushPayload(t *testing.T) {
	ok, err := NewPushPayload("  Time to learn  ", " 5 words are waiting ")
	if err != nil || ok != (PushPayload{Title: "Time to learn", Body: "5 words are waiting", URL: "/cards"}) {
		t.Fatalf("%+v %v", ok, err)
	}

	bad := map[string][2]string{
		"empty title": {"", "b"},
		"blank title": {"   ", "b"},
		"title 61":    {strings.Repeat("я", 61), "b"},
		"empty body":  {"t", ""},
		"body 201":    {"t", strings.Repeat("я", 201)},
	}
	for name, in := range bad {
		if _, err := NewPushPayload(in[0], in[1]); !errors.Is(err, ErrValidation) {
			t.Errorf("%s: %v", name, err)
		}
	}
	// the limits themselves are fine, counted in characters not bytes
	if _, err := NewPushPayload(strings.Repeat("я", 60), strings.Repeat("я", 200)); err != nil {
		t.Errorf("60/200 characters: %v", err)
	}
}
