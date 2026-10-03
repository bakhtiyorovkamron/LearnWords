package service

import (
	"reflect"
	"testing"
)

func TestSplitVariants(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"der Samstag / der Sonnabend", []string{"der Samstag", "der Sonnabend"}},
		{"Samstag/Sonnabend", []string{"Samstag", "Sonnabend"}},
		{"  a /  b / c ", []string{"a", "b", "c"}},
		{"Samstag", nil},
		{"Samstag /", nil},
		{"Ich gehe heute nach Hause / und dann schlafe ich lange", nil},
	}
	for _, c := range cases {
		if got := SplitVariants(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("SplitVariants(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}
