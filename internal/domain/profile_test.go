package domain

import (
	"strings"
	"testing"
)

func TestNormalizePhone(t *testing.T) {
	cases := []struct {
		in, want string
		wantErr  bool
	}{
		{"+998901234567", "+998901234567", false},
		{"+998 90 123 45 67", "+998901234567", false},
		{"+998-90-123-45-67", "+998901234567", false},
		{"  +998 90 123-45 67  ", "+998901234567", false},
		{"", "", false},
		{"   ", "", false},
		{"998901234567", "", true},      // no plus
		{"+99890123456", "", true},      // 8 digits
		{"+9989012345678", "", true},    // 10 digits
		{"+7 900 123 45 67", "", true},  // another country
		{"+998 90 123 45 6a", "", true}, // a letter
		{"+998 (90) 1234567", "", true}, // brackets are not accepted
	}
	for _, c := range cases {
		got, err := NormalizePhone(c.in)
		if (err != nil) != c.wantErr || got != c.want {
			t.Errorf("NormalizePhone(%q) = %q, %v; want %q, err=%v", c.in, got, err, c.want, c.wantErr)
		}
		if err != nil && err != ErrInvalidPhone {
			t.Errorf("NormalizePhone(%q): error = %v, want ErrInvalidPhone", c.in, err)
		}
	}
}

func TestNormalizeName(t *testing.T) {
	cases := []struct {
		name, in, want string
		wantErr        bool
	}{
		{"plain", "Anna", "Anna", false},
		{"trimmed", "  Anna Karenina \n", "Anna Karenina", false},
		{"two characters", "Ян", "Ян", false}, // 4 bytes, 2 characters
		{"empty", "", "", true},
		{"only spaces", "    ", "", true},
		{"one character", "A", "", true},
		{"one character with spaces", "  Я  ", "", true},
		{"80 characters", strings.Repeat("я", 80), strings.Repeat("я", 80), false},
		{"81 characters", strings.Repeat("я", 81), "", true},
	}
	for _, c := range cases {
		got, err := NormalizeName(c.in)
		if (err != nil) != c.wantErr || got != c.want {
			t.Errorf("%s: NormalizeName(%q) = %q, %v; want %q, err=%v", c.name, c.in, got, err, c.want, c.wantErr)
		}
	}
}
