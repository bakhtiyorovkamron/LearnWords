package config

import "testing"

func TestTelegramUsername(t *testing.T) {
	for in, want := range map[string]string{
		"yodla_pay":                  "yodla_pay",
		"  yodla_pay  ":              "yodla_pay",
		"@yodla_pay":                 "yodla_pay",
		"https://t.me/yodla_pay":     "yodla_pay",
		"https://t.me/yodla_pay/":    "yodla_pay",
		"HTTPS://T.ME/Yodla_Pay":     "Yodla_Pay",
		"http://t.me/@yodla_pay":     "yodla_pay",
		"t.me/yodla_pay":             "yodla_pay",
		"https://telegram.me/yodla":  "yodla",
		"https://www.t.me/yodla_pay": "yodla_pay",
		"":                           "",
	} {
		if got := telegramUsername(in); got != want {
			t.Errorf("telegramUsername(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestLoad_PaymentEnv(t *testing.T) {
	t.Setenv("JWT_SECRET", "0123456789abcdef0123456789abcdef")
	t.Setenv("PAYMENT_CARD_NUMBER", "")
	t.Setenv("PAYMENT_CARD_HOLDER", "")
	t.Setenv("PAYMENT_TELEGRAM", " https://t.me/yodla_pay ")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.PaymentTelegram != "yodla_pay" || c.PaymentCardNumber != "" || c.PaymentCardHolder != "" {
		t.Errorf("payment config: %q %q %q", c.PaymentCardNumber, c.PaymentCardHolder, c.PaymentTelegram)
	}
}

func TestLoad_WordsWithoutTelegram(t *testing.T) {
	t.Setenv("JWT_SECRET", "0123456789abcdef0123456789abcdef")
	for in, want := range map[string]int{
		"":     50, // default
		"50":   50,
		" 30 ": 30,
		"0":    0, // the rule is off
		"off":  0,
		"abc":  50, // a typo keeps the default, it does not switch the limit off
		"-5":   50,
	} {
		t.Setenv("WORDS_WITHOUT_TELEGRAM", in)
		c, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if c.WordsWithoutTelegram != want {
			t.Errorf("WORDS_WITHOUT_TELEGRAM=%q → %d, want %d", in, c.WordsWithoutTelegram, want)
		}
	}
}
