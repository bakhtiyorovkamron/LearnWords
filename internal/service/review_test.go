package service

import "testing"

func TestNormalizeSessionSize(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"10", 10},
		{"20", 20},
		{"50", 50},
		{"all", unlimitedSessionSize},
		{"", DefaultSessionSize},
		{"0", DefaultSessionSize},
		{"100", DefaultSessionSize}, // not one of the allowed sizes
		{"ALL", DefaultSessionSize}, // case-sensitive: only the exact lowercase values are valid
	}
	for _, c := range cases {
		if got := NormalizeSessionSize(c.in); got != c.want {
			t.Errorf("NormalizeSessionSize(%q) = %d, want %d", c.in, got, c.want)
		}
	}
}
