package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"learnwords/internal/domain"
)

func TestTheme_DefaultsToNone_Persists_AndOnlyTheKnownNamesPass(t *testing.T) {
	f := newMoveFixture(t)
	users, ctx := &UserRepository{pool: f.pool}, context.Background()

	if got, err := users.Theme(ctx, f.user); err != nil || got != "" {
		t.Fatalf("a user who never chose: %q %v", got, err)
	}
	for _, theme := range []string{"auto", "night", "light", "graphite", "sand", "navy"} {
		if err := users.SetTheme(ctx, f.user, theme); err != nil {
			t.Fatalf("%s: %v", theme, err)
		}
		if got, _ := users.Theme(ctx, f.user); got != theme {
			t.Errorf("stored %q, read %q", theme, got)
		}
	}
	// the database itself refuses anything else (the CHECK from the migration)
	for _, bad := range []string{"dark", "Light", "", "purple"} {
		if err := users.SetTheme(ctx, f.user, bad); err == nil {
			t.Errorf("%q was accepted", bad)
		}
	}
	if got, _ := users.Theme(ctx, f.user); got != "navy" {
		t.Errorf("a refused value changed the theme: %q", got)
	}
	if err := users.SetTheme(ctx, uuid.New(), "sand"); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("unknown user: %v", err)
	}
	if _, err := users.Theme(ctx, uuid.New()); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("unknown user: %v", err)
	}
}
