package service

import (
	"reflect"
	"testing"
)

func TestPhotoQueries(t *testing.T) {
	got := photoQueries("Ich hätte gern einen Kaffee mit Milch, bitte.")
	want := []string{"Kaffee Milch", "Kaffee", "Milch"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}
