package service

import "testing"

func TestSearchCacheKey_IncludesLanguages(t *testing.T) {
	const query = "daftar"

	uzDe := SearchCacheKey("de", "uz", query)
	ruDe := SearchCacheKey("de", "ru", query)
	uzEn := SearchCacheKey("en", "uz", query)

	if uzDe == ruDe {
		t.Errorf("ключ не учитывает native_language: uz и ru дали одинаковый ключ %q", uzDe)
	}
	if uzDe == uzEn {
		t.Errorf("ключ не учитывает learning_language: de и en дали одинаковый ключ %q", uzDe)
	}
}

func TestSearchCacheKey_Deterministic(t *testing.T) {
	a := SearchCacheKey("de", "uz", "men")
	b := SearchCacheKey("de", "uz", "men")

	if a != b {
		t.Errorf("ключ не детерминирован: %q != %q", a, b)
	}
}

func TestSearchCacheKey_DifferentQueries(t *testing.T) {
	a := SearchCacheKey("de", "uz", "men")
	b := SearchCacheKey("de", "uz", "kitob")

	if a == b {
		t.Errorf("разные запросы дали одинаковый ключ %q", a)
	}
}

func TestSearchCacheKey_NormalizesQuery(t *testing.T) {
	a := SearchCacheKey("de", "uz", "  Men ")
	b := SearchCacheKey("de", "uz", "men")

	if a != b {
		t.Errorf("регистр и пробелы должны игнорироваться: %q != %q", a, b)
	}
}
