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
