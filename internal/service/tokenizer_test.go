package service

import (
	"reflect"
	"testing"
)

func TestTokenize(t *testing.T) {
	got := Tokenize("Guten Morgen! Wie geht es dir heute? Morgen, Straße.", "de")
	want := []string{"Guten", "Morgen", "geht", "dir", "heute", "Straße"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}
