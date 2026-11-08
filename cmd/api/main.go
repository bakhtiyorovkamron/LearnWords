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
	_ "time/tzdata" // Asia/Tashkent (daily limits) must resolve in the minimal Docker image

	"github.com/gin-gonic/gin"

	"learnwords/internal/auth"
	"learnwords/internal/config"
	"learnwords/internal/domain"
	"learnwords/internal/handler"
	"learnwords/internal/provider/anthropic"
	"learnwords/internal/provider/telegram"
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
	} else if err := postgres.CheckMigrated(ctx, pool); err != nil {
		return err // never serve on an old schema
	}

	// Repositories
	userRepo := postgres.NewUserRepository(pool)
	contextRepo := postgres.NewContextRepository(pool)
	cardRepo := postgres.NewWordCardRepository(pool)

	// External integrations: the Anthropic client below (when ANTHROPIC_API_KEY is set).
	var providers service.Providers
	// AI: example sentences + daily stories + word search + word check + photo import, enabled only
	// when the key is provided via environment.
	var storyGen service.StoryGenerator
	var storyTranslator service.StoryTranslator
	var storyProofreader service.StoryProofreader
	var wordChecker service.WordChecker
	var wordLookup service.WordLookup
	var photoReader service.PhotoReader

	if key := os.Getenv("ANTHROPIC_API_KEY"); key != "" {
		ai := anthropic.New(key, os.Getenv("ANTHROPIC_MODEL"))
		providers.Examples = ai
		storyGen = ai
		storyTranslator = ai
		storyProofreader = ai
		wordChecker = ai
		wordLookup = ai
		photoReader = ai
	} else {
		slog.Warn("ANTHROPIC_API_KEY is not set: example, story, word search and photo import are disabled")
	}

	folderRepo := postgres.NewFolderRepository(pool)

	// Services
	tokens := auth.NewTokenManager(cfg.JWTSecret, cfg.JWTIssuer, cfg.AccessTTL, cfg.RefreshTTL)
	authSvc := service.NewAuthService(userRepo, tokens)
	// New users get the "Introductions" folder; if the content can't be loaded they just don't.
	if starterSvc, err := service.NewStarterService(contextRepo); err != nil {
		slog.Error("starter folder is off", "err", err)
	} else {
		authSvc.SetStarter(starterSvc)
	}
	contextSvc := service.NewContextService(contextRepo, cardRepo, providers)
	storySvc := service.NewStoryService(postgres.NewStoryRepository(pool), storyGen, storyTranslator, storyProofreader)
	adminRepo := postgres.NewAdminRepository(pool)
	featureRepo := postgres.NewFeatureRepository(pool)
	featureSvc := service.NewFeatureService(featureRepo)
	feedbackRepo := postgres.NewFeedbackRepository(pool)
	pushSvc := service.NewPushService(postgres.NewPushRepository(pool), cfg.VAPIDPublicKey, cfg.VAPIDPrivateKey, cfg.VAPIDSubject)
	if !pushSvc.Enabled() {
		slog.Warn("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set: Web Push is disabled (generate keys with `go run ./cmd/vapidkeys`)")
	}
	purchaseSvc := service.NewPurchaseService(postgres.NewPurchaseRepository(pool), featureRepo, pushSvc, domain.PaymentInfo{
		CardNumber: cfg.PaymentCardNumber, CardHolder: cfg.PaymentCardHolder, Telegram: cfg.PaymentTelegram,
	})
	if !purchaseSvc.Available() {
		slog.Warn("neither PAYMENT_CARD_NUMBER nor PAYMENT_TELEGRAM is set: buying photos is off (purchase endpoints answer 503)")
	}
	var bot service.TelegramBot // nil = no bot: the Telegram endpoints answer 503
	if cfg.TelegramBotToken != "" {
		bot = telegram.New(cfg.TelegramBotToken)
	}
	telegramSvc := service.NewTelegramService(postgres.NewTelegramRepository(pool), bot, cfg.TelegramBotUsername)
	if !telegramSvc.Enabled() {
		slog.Warn("TELEGRAM_BOT_TOKEN / TELEGRAM_BOT_USERNAME are not set: linking Telegram is disabled")
	} else if cfg.TelegramWebhookURL != "" {
		if cfg.TelegramWebhookSecret == "" {
			slog.Warn("TELEGRAM_WEBHOOK_SECRET is not set: the webhook would reject every update, not registering it")
		} else {
			// In the background: a slow or failing Telegram never holds up or stops the server.
			go func() {
				c, cancel := context.WithTimeout(ctx, 30*time.Second)
				defer cancel()
				if err := telegramSvc.RegisterWebhook(c, cfg.TelegramWebhookURL, cfg.TelegramWebhookSecret); err != nil {
					slog.Error("telegram: setWebhook failed", "err", err) // the client already scrubbed the token
					return
				}
				slog.Info("telegram: webhook registered", "url", cfg.TelegramWebhookURL)
			}()
		}
	}
	heroSvc := service.NewHeroService(userRepo, postgres.NewHeroRepository(pool), cfg.HeroEnabled)
	reviewSvc := service.NewReviewService(postgres.NewReviewRepository(pool))
	wordCheckSvc := service.NewWordCheckService(wordChecker, postgres.NewWordCheckCacheRepository(pool), postgres.NewSearchCacheRepository(pool))
	wordFixSvc := service.NewWordFixService(postgres.NewWordFixRepository(pool), wordCheckSvc)

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
		ServiceName: cfg.ServiceName,
		CORSOrigins: cfg.CORSOrigins,
		Tokens:      tokens,
		Auth:        handler.NewAuthHandler(authSvc, cfg.CookieSecure),
		Contexts:    handler.NewContextHandler(contextSvc),
		Review:      handler.NewReviewHandler(reviewSvc),
		Practice:    handler.NewPracticeHandler(reviewSvc),
		WordCheck:   handler.NewWordCheckHandler(wordCheckSvc, wordFixSvc),
		Stats:       handler.NewStatsHandler(service.NewStatsService(postgres.NewStatsRepository(pool))),
		Stories:     handler.NewStoryHandler(storySvc, featureSvc),
		Settings:    handler.NewSettingsHandler(userRepo),
		Profile:     handler.NewProfileHandler(userRepo, telegramSvc.Enabled()),
		Telegram:    handler.NewTelegramHandler(telegramSvc, cfg.TelegramWebhookSecret),
		Admin:       handler.NewAdminHandler(adminRepo, userRepo, featureSvc, feedbackRepo),
		Collection:  handler.NewCollectionHandler(cardRepo),
		WordEdit:    handler.NewWordEditHandler(cardRepo),
		WordMove:    handler.NewWordMoveHandler(cardRepo),
		WordDelete:  handler.NewWordDeleteHandler(cardRepo),
		Folders:     handler.NewFolderHandler(folderRepo),
		Shared:      handler.NewSharedHandler(folderRepo),
		Search:      handler.NewSearchHandler(service.NewSearchService(wordLookup, cardRepo, contextSvc, postgres.NewSearchCacheRepository(pool)), featureSvc),
		Feedback:    handler.NewFeedbackHandler(feedbackRepo),
		Push:        handler.NewPushHandler(pushSvc),
		Photo:       handler.NewPhotoHandler(service.NewPhotoImportService(photoReader, cardRepo, featureSvc)),
		Hero:        handler.NewHeroHandler(heroSvc),
		Purchases:   handler.NewPurchaseHandler(purchaseSvc),
		UserStatus:  adminRepo,
		Ctx:         ctx,
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
	err = srv.Shutdown(shCtx)
	purchaseSvc.Wait() // purchase pushes still on their way
	return err
}
