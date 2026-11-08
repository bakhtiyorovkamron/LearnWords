package config

import (
	"errors"
	"os"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr     string
	DatabaseURL  string
	DBMaxConns   int32
	JWTSecret    string
	JWTIssuer    string
	AccessTTL    time.Duration
	RefreshTTL   time.Duration
	CORSOrigins  []string
	ServiceName  string
	OTLPEndpoint string // empty = tracing without export
	AutoMigrate  bool
	CookieSecure bool // set true behind HTTPS
	// HeroEnabled: FEATURE_HERO_ENABLED (default true). false → GET /api/hero answers 404 for
	// everyone — a switch to hide the hero quickly without a deploy of code.
	HeroEnabled bool
	// Web Push (VAPID). Without both keys push is switched off: subscribe/send answer 503.
	VAPIDPublicKey  string
	VAPIDPrivateKey string
	VAPIDSubject    string // e.g. mailto:admin@yodla.fun
	// Buying photo credits (manual payment). Server env only, never in the repo. Paid by a card
	// transfer, or arranged in Telegram; with neither set the purchase endpoints answer 503
	// payments_unavailable.
	PaymentCardNumber string // PAYMENT_CARD_NUMBER
	PaymentCardHolder string // PAYMENT_CARD_HOLDER
	PaymentTelegram   string // PAYMENT_TELEGRAM: a channel or user name, stored without @ / t.me link
}

func Load() (*Config, error) {
	c := &Config{
		HTTPAddr:     env("HTTP_ADDR", ":8080"),
		DatabaseURL:  env("DATABASE_URL", "postgres://learnwords:learnwords@localhost:5432/learnwords?sslmode=disable"),
		DBMaxConns:   10,
		JWTSecret:    os.Getenv("JWT_SECRET"),
		JWTIssuer:    env("JWT_ISSUER", "learnwords"),
		AccessTTL:    duration("JWT_ACCESS_TTL", 15*time.Minute),
		RefreshTTL:   duration("JWT_REFRESH_TTL", 30*24*time.Hour),
		CORSOrigins:  strings.Split(env("CORS_ORIGINS", "http://localhost:5173"), ","),
		ServiceName:  env("SERVICE_NAME", "learnwords-api"),
		OTLPEndpoint: os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"),
		AutoMigrate:  env("AUTO_MIGRATE", "true") == "true",
		CookieSecure: env("COOKIE_SECURE", "false") == "true",
		HeroEnabled:  !isOff(env("FEATURE_HERO_ENABLED", "true")),

		VAPIDPublicKey:  strings.TrimSpace(os.Getenv("VAPID_PUBLIC_KEY")),
		VAPIDPrivateKey: strings.TrimSpace(os.Getenv("VAPID_PRIVATE_KEY")),
		VAPIDSubject:    env("VAPID_SUBJECT", "mailto:admin@yodla.fun"),

		PaymentCardNumber: strings.TrimSpace(os.Getenv("PAYMENT_CARD_NUMBER")),
		PaymentCardHolder: strings.TrimSpace(os.Getenv("PAYMENT_CARD_HOLDER")),
		PaymentTelegram:   telegramUsername(os.Getenv("PAYMENT_TELEGRAM")),
	}
	if len(c.JWTSecret) < 32 {
		return nil, errors.New("JWT_SECRET must be set and at least 32 characters long")
	}
	return c, nil
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func duration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}

// telegramUsername turns what an operator may paste ("@yodla", "https://t.me/yodla",
// "t.me/yodla/") into the bare username "yodla".
func telegramUsername(v string) string {
	v = strings.TrimSpace(v)
	lower := strings.ToLower(v)
	for _, scheme := range []string{"https://", "http://"} {
		if strings.HasPrefix(lower, scheme) {
			v, lower = v[len(scheme):], lower[len(scheme):]
		}
	}
	for _, host := range []string{"www.t.me/", "t.me/", "telegram.me/"} {
		if strings.HasPrefix(lower, host) {
			v = v[len(host):]
			break
		}
	}
	return strings.TrimSuffix(strings.TrimPrefix(v, "@"), "/")
}

// isOff: "false", "0", "no", "off" (any case).
func isOff(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "false", "0", "no", "off":
		return true
	}
	return false
}
