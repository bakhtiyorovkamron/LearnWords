package domain

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

func TestNewLinkCode_FormatAndCharset(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 2000; i++ {
		c, err := NewLinkCode(nil)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(c, "YL-") || len(c) != 9 {
			t.Fatalf("code %q: want YL- and 6 characters", c)
		}
		for _, r := range c[3:] {
			if !strings.ContainsRune(LinkCodeAlphabet, r) {
				t.Fatalf("code %q has %q outside the alphabet", c, r)
			}
		}
		if strings.ContainsAny(c[3:], "0O1I") {
			t.Fatalf("code %q has a look-alike character", c)
		}
		if !IsLinkCode(c) {
			t.Fatalf("IsLinkCode(%q) = false", c)
		}
		seen[c] = true
	}
	if len(seen) < 1990 { // 32^6 ≈ 1e9 codes: 2000 draws practically never repeat
		t.Errorf("only %d distinct codes out of 2000", len(seen))
	}
}

func TestLinkCodeAlphabet(t *testing.T) {
	if len(LinkCodeAlphabet) != 32 {
		t.Fatalf("alphabet has %d characters, want 32 (no modulo bias)", len(LinkCodeAlphabet))
	}
	for _, r := range "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" {
		if !strings.ContainsRune(LinkCodeAlphabet, r) {
			t.Errorf("%q is missing", r)
		}
	}
}

func TestNewLinkCode_UsesEveryCharacter(t *testing.T) {
	// Bytes 0..255: each maps to alphabet[b % 32], so the whole alphabet appears.
	src := make([]byte, 256)
	for i := range src {
		src[i] = byte(i)
	}
	r := bytes.NewReader(src)
	got := map[byte]bool{}
	for r.Len() >= LinkCodeLen {
		c, err := NewLinkCode(r)
		if err != nil {
			t.Fatal(err)
		}
		for i := 3; i < len(c); i++ {
			got[c[i]] = true
		}
	}
	if len(got) != 32 {
		t.Errorf("%d distinct characters, want 32", len(got))
	}
}

func TestNewLinkCode_ShortRandomnessFails(t *testing.T) {
	if _, err := NewLinkCode(bytes.NewReader([]byte{1, 2})); err == nil {
		t.Error("want an error when the random source runs dry")
	}
}

func TestIsLinkCode(t *testing.T) {
	for in, want := range map[string]bool{
		"YL-ABC234":  true,
		"YL-abc234":  false, // lower case
		"YL-ABC23":   false,
		"YL-ABC2345": false,
		"YL-ABC0O1":  false, // look-alikes
		"XX-ABC234":  false,
		"":           false,
		"YL-ABC 34":  false,
	} {
		if got := IsLinkCode(in); got != want {
			t.Errorf("IsLinkCode(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestLinkCodeActive(t *testing.T) {
	now := time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC)
	used := now.Add(-time.Minute)
	cases := []struct {
		name    string
		expires time.Time
		used    *time.Time
		want    bool
	}{
		{"fresh", now.Add(LinkCodeTTL), nil, true},
		{"one second left", now.Add(time.Second), nil, true},
		{"expires right now", now, nil, false},
		{"expired", now.Add(-time.Second), nil, false},
		{"used", now.Add(LinkCodeTTL), &used, false},
	}
	for _, c := range cases {
		if got := LinkCodeActive(c.expires, c.used, now); got != c.want {
			t.Errorf("%s: active = %v, want %v", c.name, got, c.want)
		}
	}
}
