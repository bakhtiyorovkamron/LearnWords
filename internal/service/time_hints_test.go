package service

import (
	"reflect"
	"testing"
)

func TestTimeQueries(t *testing.T) {
	cases := map[string][]string{
		"Wie spät ist es?":                    {"clock"},
		"Der Zug kommt um 8 Uhr.":             {"clock"},
		"Wir treffen uns um 14:30.":           {"clock"},
		"Es ist halb neun.":                   {"clock"},
		"Guten Morgen! Wie geht es dir?":      {"morning sunrise"},
		"Ich komme morgen.":                   {"calendar"},
		"Am Abend gehen wir ins Kino.":        {"evening sunset"},
		"Am Montag habe ich einen Termin.":    {"calendar", "calendar appointment"},
		"Im Herbst fallen die Blätter.":       {"autumn leaves"},
		"Ich hätte gern einen Kaffee, bitte.": nil,
	}
	for in, want := range cases {
		if got := timeQueries(in); !reflect.DeepEqual(got, want) {
			t.Errorf("%q: got %v, want %v", in, got, want)
		}
	}
}

func TestHasClockTime(t *testing.T) {
	cases := map[string]bool{
		"halb acht":                 true,
		"Es ist Viertel nach drei.": true,
		"fünf vor halb neun":        true,
		"um acht Uhr":               true,
		"Der Zug kommt um 8 Uhr.":   true,
		"Wir treffen uns um 14:30.": true,
		"Die Uhr ist kaputt.":       false,
		"Wie spät ist es?":          false,
		"Ich komme morgen.":         false,
	}
	for in, want := range cases {
		if got := hasClockTime(in); got != want {
			t.Errorf("%q: got %v, want %v", in, got, want)
		}
	}
}
