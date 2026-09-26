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
	TargetLang   string // language to translate into
	AutoMigrate  bool
	CookieSecure bool // set true behind HTTPS
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
		TargetLang:   env("TRANSLATION_TARGET_LANG", "ru"),
		AutoMigrate:  env("AUTO_MIGRATE", "true") == "true",
		CookieSecure: env("COOKIE_SECURE", "false") == "true",
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
