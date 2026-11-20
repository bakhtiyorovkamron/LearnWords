package domain

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestDeviceFromUserAgent(t *testing.T) {
	for _, tc := range []struct{ ua, want string }{
		{"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", "iPhone · Safari"},
		{"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1", "iPhone · Chrome"},
		{"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 337.0.3.23.54 (iPhone14,5; iOS 17_5)", "iPhone · Instagram"},
		{"Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15", "iPad · Firefox"},
		{"Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36", "Android · Chrome"},
		{"Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 Telegram-Android/10.14.5 (Google Pixel 7; Android 13; SDK 33; HIGH)", "Android · Telegram"},
		{"Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 EdgA/126.0.2592.80", "Android · Edge"},
		{"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.87", "Windows · Edge"},
		{"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", "Windows · Chrome"},
		{"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0", "Windows · Firefox"},
		{"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", "Mac · Safari"},
		{"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", "Mac · Chrome"},
		{"Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0", "Linux · Firefox"},
		{"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", "Linux · Chrome"},
		{"curl/8.4.0", "браузер"},
		{"", "браузер"},
		{"Mozilla/5.0 (Windows NT 10.0) SomethingElse/1.0", "Windows · браузер"},
	} {
		if got := DeviceFromUserAgent(tc.ua); got != tc.want {
			t.Errorf("%q\n  = %q, want %q", tc.ua, got, tc.want)
		}
	}
}

func TestDeviceFromUserAgent_AtMost60Characters(t *testing.T) {
	got := DeviceFromUserAgent("Windows " + strings.Repeat("x", 500))
	if n := utf8.RuneCountInString(got); n > TelegramDeviceMax {
		t.Errorf("%d characters: %q", n, got)
	}
}

func TestNewTelegramLoginCode(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 50; i++ {
		code, err := NewTelegramLoginCode(nil)
		if err != nil {
			t.Fatal(err)
		}
		if !IsTelegramLoginCode(code) || len(code) != 38 || !strings.HasPrefix(code, "login_") {
			t.Fatalf("code %q", code)
		}
		if seen[code] {
			t.Fatalf("code %q twice", code)
		}
		seen[code] = true
	}
	// Bytes of 248 and above are skipped (no bias): 0xFF never becomes a character.
	code, err := NewTelegramLoginCode(bytes.NewReader(append(bytes.Repeat([]byte{0xFF}, 32), bytes.Repeat([]byte{61}, 32)...)))
	if err != nil || code != "login_"+strings.Repeat("9", 32) {
		t.Errorf("code %q, err %v", code, err)
	}
}

func TestIsTelegramLoginCode(t *testing.T) {
	ok := "login_" + strings.Repeat("aZ9", 10) + "Qq"
	for s, want := range map[string]bool{
		ok:                                       true,
		"login_" + strings.Repeat("a", 31):       false,
		"login_" + strings.Repeat("a", 33):       false,
		"login_" + strings.Repeat("a", 31) + "-": false,
		"login_" + strings.Repeat("a", 31) + "_": false,
		"LOGIN_" + strings.Repeat("a", 32):       false,
		"YL-ABC234":                              false,
		"":                                       false,
	} {
		if got := IsTelegramLoginCode(s); got != want {
			t.Errorf("IsTelegramLoginCode(%q) = %v", s, got)
		}
	}
}

func TestTelegramLoginSecret(t *testing.T) {
	secret, hash, err := NewTelegramLoginSecret(nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := base64.RawURLEncoding.DecodeString(secret)
	if err != nil || len(raw) != 32 || len(secret) != 43 {
		t.Fatalf("secret %q: %d bytes, err %v", secret, len(raw), err)
	}
	if sum := sha256.Sum256(raw); !bytes.Equal(hash, sum[:]) {
		t.Error("the hash is not sha256 of the secret")
	}
	if got, ok := TelegramLoginSecretHash(secret); !ok || !bytes.Equal(got, hash) {
		t.Error("TelegramLoginSecretHash does not match the stored hash")
	}
	for _, bad := range []string{"", "short", secret + "A", secret[:42], strings.Repeat("!", 43)} {
		if _, ok := TelegramLoginSecretHash(bad); ok {
			t.Errorf("%q accepted as a secret", bad)
		}
	}
}

func TestTelegramEmail(t *testing.T) {
	if got := TelegramEmail(123456789); got != "tg123456789@telegram.yodla.fun" {
		t.Errorf("TelegramEmail = %q", got)
	}
	for email, want := range map[string]bool{
		"tg123@telegram.yodla.fun":  true,
		"TG123@Telegram.Yodla.Fun ": true,
		"anna@yodla.fun":            false,
		"anna@telegram.yodla.fun.x": false,
		"telegram.yodla.fun@gmail":  false,
	} {
		if got := IsTelegramEmail(email); got != want {
			t.Errorf("IsTelegramEmail(%q) = %v", email, got)
		}
	}
}

func TestTelegramFullName(t *testing.T) {
	for _, tc := range []struct {
		first, last string
		want        *string
	}{
		{"Anna", "Karimova", ptr("Anna Karimova")},
		{"  Anna ", "", ptr("Anna")},
		{"", "Karimova", ptr("Karimova")},
		{"", " ", nil},
	} {
		got := TelegramFullName(tc.first, tc.last)
		if (got == nil) != (tc.want == nil) || (got != nil && *got != *tc.want) {
			t.Errorf("TelegramFullName(%q, %q) = %v", tc.first, tc.last, got)
		}
	}
	long := TelegramFullName(strings.Repeat("я", 64), strings.Repeat("ю", 64))
	if n := utf8.RuneCountInString(*long); n != MaxNameLen {
		t.Errorf("a 129-character name is cut to %d, want %d", n, MaxNameLen)
	}
}

func ptr(s string) *string { return &s }
