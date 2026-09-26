package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"learnwords/internal/auth"
	"learnwords/internal/config"
	"learnwords/internal/handler"
	"learnwords/internal/provider/mock"
	"learnwords/internal/repository/postgres"
	"learnwords/internal/service"
	"learnwords/internal/telemetry"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	shutdownTracing, err := telemetry.Setup(ctx, cfg.ServiceName, cfg.OTLPEndpoint)
	if err != nil {
		return err
	}
	defer func() {
		c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = shutdownTracing(c)
	}()

	pool, err := postgres.NewPool(ctx, cfg.DatabaseURL, cfg.DBMaxConns)
	if err != nil {
		return err
	}
	defer pool.Close()

	if cfg.AutoMigrate {
		if err := postgres.Migrate(ctx, pool); err != nil {
			return err
		}
		slog.Info("migrations applied")
	}

	// Repositories
	userRepo := postgres.NewUserRepository(pool)
	contextRepo := postgres.NewContextRepository(pool)
	cardRepo := postgres.NewWordCardRepository(pool)

	// External integrations — mocks for now; replace with real clients later.
	providers := service.Providers{
		OCR:         mock.OCR{},
		Translator:  mock.Translator{},
		Transcriber: mock.Transcriber{},
		TTS:         mock.TTS{},
		Storage:     mock.NewStorage(),
	}

	// Services
	tokens := auth.NewTokenManager(cfg.JWTSecret, cfg.JWTIssuer, cfg.AccessTTL, cfg.RefreshTTL)
	authSvc := service.NewAuthService(userRepo, tokens)
	contextSvc := service.NewContextService(contextRepo, cardRepo, providers, cfg.TargetLang)

	if os.Getenv("GIN_MODE") == "" {
		gin.SetMode(gin.ReleaseMode)
	}
	router := handler.NewRouter(handler.RouterDeps{
		ServiceName: cfg.ServiceName,
		CORSOrigins: cfg.CORSOrigins,
		Tokens:      tokens,
		Auth:        handler.NewAuthHandler(authSvc, cfg.CookieSecure),
		Contexts:    handler.NewContextHandler(contextSvc),
		HealthCheck: func() error {
			c, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			return pool.Ping(c)
		},
	})

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		slog.Info("http server started", "addr", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}

	slog.Info("shutting down")
	shCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return srv.Shutdown(shCtx)
}
