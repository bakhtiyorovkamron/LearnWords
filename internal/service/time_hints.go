package service

import (
	"regexp"
	"strings"
	"unicode"
)

// Openverse is tagged mostly in English, so German time words ("Uhr", "Abend", "Montag")
// match random photos. For phrases about time we search with English visual keywords instead.

var clockRe = regexp.MustCompile(`(?i)\b\d{1,2}([:.]\d{2})?\s*uhr\b|\b\d{1,2}:\d{2}\b|\b(halb|viertel)\s+(nach|vor)?\s*\w+`)

// Keys are exact tokens (case matters: "Morgen" = morning, "morgen" = tomorrow).
var timeHints = map[string]string{
	// clock & duration
	"Uhr": "clock", "Uhrzeit": "clock", "Wecker": "alarm clock", "Armbanduhr": "wristwatch",
	"Stunde": "clock", "Stunden": "clock", "Minute": "clock", "Minuten": "clock",
	"Sekunde": "stopwatch", "Sekunden": "stopwatch", "spät": "clock", "pünktlich": "clock",
	"Zeit": "clock", "Termin": "calendar appointment",

	// parts of the day
	"Morgen": "morning sunrise", "morgens": "morning sunrise", "früh": "morning sunrise",
	"Vormittag": "morning coffee", "vormittags": "morning coffee",
	"Mittag": "noon sun", "mittags": "lunch", "Mittagessen": "lunch",
	"Nachmittag": "afternoon", "nachmittags": "afternoon",
	"Abend": "evening sunset", "abends": "evening sunset", "Abendessen": "dinner",
	"Nacht": "night sky", "nachts": "night sky", "Mitternacht": "midnight",
	"Sonnenaufgang": "sunrise", "Sonnenuntergang": "sunset",

	// relative days
	"morgen": "calendar", "gestern": "calendar", "übermorgen": "calendar", "vorgestern": "calendar",
	"Tag": "calendar", "Tage": "calendar", "Datum": "calendar", "Kalender": "calendar",

	// weekdays & week
	"Montag": "calendar", "Dienstag": "calendar", "Mittwoch": "calendar", "Donnerstag": "calendar",
	"Freitag": "calendar", "Samstag": "calendar", "Sonnabend": "calendar", "Sonntag": "calendar",
	"Woche": "calendar", "Wochen": "calendar", "Wochenende": "weekend relax", "Feierabend": "evening relax",

	// months & seasons
	"Januar": "winter snow", "Februar": "winter snow", "Dezember": "winter snow",
	"März": "spring flowers", "April": "spring flowers", "Mai": "spring flowers",
	"Juni": "summer beach", "Juli": "summer beach", "August": "summer beach",
	"September": "autumn leaves", "Oktober": "autumn leaves", "November": "autumn leaves",
	"Frühling": "spring flowers", "Sommer": "summer beach", "Herbst": "autumn leaves", "Winter": "winter snow",
	"Monat": "calendar", "Monate": "calendar", "Jahr": "calendar", "Jahre": "calendar",
	"Geburtstag": "birthday cake", "Silvester": "fireworks", "Weihnachten": "christmas tree",
}

// timeQueries returns English search queries if the phrase is about time, else nil.
func timeQueries(text string) []string {
	var qs []string
	add := func(q string) {
		for _, e := range qs {
			if e == q {
				return
			}
		}
		qs = append(qs, q)
	}

	if clockRe.MatchString(text) {
		add("clock")
	}
	tokens := strings.FieldsFunc(text, func(r rune) bool { return !unicode.IsLetter(r) })
	for i, t := range tokens {
		// "Guten Morgen" etc.: sentence-initial capitalization of "morgen" should still mean morning.
		if q, ok := timeHints[t]; ok {
			add(q)
			continue
		}
		if i == 0 {
			if q, ok := timeHints[strings.ToLower(t)]; ok {
				add(q)
			}
		}
	}
	if len(qs) > 3 {
		qs = qs[:3]
	}
	return qs
}
