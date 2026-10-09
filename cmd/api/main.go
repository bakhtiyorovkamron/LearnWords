package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"learnwords/internal/auth"
	"learnwords/internal/config"
	"learnwords/internal/handler"
	"learnwords/internal/provider/anthropic"
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
	// AI: example sentences + daily stories + word search + on-demand translation, enabled only
	// when the key is provided via environment.
	var storyGen service.StoryGenerator
	var wordLookup service.WordLookup
	var wordTranslator service.WordTranslator

	if key := os.Getenv("ANTHROPIC_API_KEY"); key != "" {
		ai := anthropic.New(key, os.Getenv("ANTHROPIC_MODEL"))
		providers.Examples = ai
		storyGen = ai
		wordLookup = ai
		wordTranslator = ai
	} else {
		slog.Warn("ANTHROPIC_API_KEY is not set: example, story, word search and translation generation are disabled")
	}

	// Services
	tokens := auth.NewTokenManager(cfg.JWTSecret, cfg.JWTIssuer, cfg.AccessTTL, cfg.RefreshTTL)
	authSvc := service.NewAuthService(userRepo, tokens)
	contextSvc := service.NewContextService(contextRepo, cardRepo, providers, cfg.TargetLang)
	storySvc := service.NewStoryService(postgres.NewStoryRepository(pool), storyGen)
	adminRepo := postgres.NewAdminRepository(pool)

	// Daily story cron: STORY_CRON_HOUR (default 23) in STORY_CRON_TZ (default Europe/Berlin).
	cronHour := 23
	if h, err := strconv.Atoi(os.Getenv("STORY_CRON_HOUR")); err == nil && h >= 0 && h < 24 {
		cronHour = h
	}
	cronTZ := os.Getenv("STORY_CRON_TZ")
	if cronTZ == "" {
		cronTZ = "Europe/Berlin"
	}
	loc, err := time.LoadLocation(cronTZ)
	if err != nil {
		slog.Warn("invalid STORY_CRON_TZ, using UTC", "tz", cronTZ)
		loc = time.UTC
	}
	go storySvc.RunScheduler(ctx, cronHour, loc)

	if os.Getenv("GIN_MODE") == "" {
		gin.SetMode(gin.ReleaseMode)
	}
	router := handler.NewRouter(handler.RouterDeps{
		ServiceName:  cfg.ServiceName,
		CORSOrigins:  cfg.CORSOrigins,
		Tokens:       tokens,
		Auth:         handler.NewAuthHandler(authSvc, cfg.CookieSecure),
		Contexts:     handler.NewContextHandler(contextSvc),
		Review:       handler.NewReviewHandler(service.NewReviewService(postgres.NewReviewRepository(pool))),
		Stats:        handler.NewStatsHandler(service.NewStatsService(postgres.NewStatsRepository(pool))),
		Stories:      handler.NewStoryHandler(storySvc),
		Settings:     handler.NewSettingsHandler(userRepo),
		Admin:        handler.NewAdminHandler(adminRepo, userRepo),
		Collection:   handler.NewCollectionHandler(cardRepo),
		WordEdit:     handler.NewWordEditHandler(cardRepo),
		Folders:      handler.NewFolderHandler(postgres.NewFolderRepository(pool)),
		Search:       handler.NewSearchHandler(service.NewSearchService(wordLookup, cardRepo, contextSvc, postgres.NewSearchCacheRepository(pool))),
		Translations: handler.NewTranslationHandler(service.NewTranslationService(cardRepo, postgres.NewWordTranslationRepository(pool), wordTranslator)),
		UserStatus:   adminRepo,
		Ctx:          ctx,
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
		// Story generation may retry the LLM call up to 3 times (each up to ~2 min).
		WriteTimeout: 7 * time.Minute,
		IdleTimeout:  120 * time.Second,
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
