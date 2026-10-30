package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin"

	"learnwords/internal/service"
)

type RouterDeps struct {
	ServiceName  string
	CORSOrigins  []string
	Tokens       service.TokenManager
	Auth         *AuthHandler
	Contexts     *ContextHandler
	Review       *ReviewHandler
	Stats        *StatsHandler
	Stories      *StoryHandler
	Settings     *SettingsHandler
	Admin        *AdminHandler
	Collection   *CollectionHandler
	WordEdit     *WordEditHandler
	WordMove     *WordMoveHandler
	Folders      *FolderHandler
	Shared       *SharedHandler
	Search       *SearchHandler
	Photo        *PhotoHandler
	Feedback     *FeedbackHandler
	Push         *PushHandler
	Translations *TranslationHandler
	Hero         *HeroHandler
	Practice     *PracticeHandler
	WordCheck    *WordCheckHandler
	UserStatus   UserStatusStore
	HealthCheck  func() error
	// Ctx stops the rate limiters' cleanup goroutines on shutdown.
	Ctx context.Context
}

// Rate limits (per minute). In-memory, per backend process.
const (
	authPerIPPerMin      = 10  // login/register, by IP
	aiPerUserPerMin      = 20  // search-word, generate-example
	storyPerUserPerMin   = 5   // daily story generation
	checkPerUserPerMin   = 40  // word check while typing (debounced; repeats come from the cache)
	sharedPerIPPerMin    = 30  // public shared-folder preview, by IP
	importPerUserPerMin  = 10  // importing a shared folder
	photoPerUserPerMin   = 5   // photo import (also capped by the daily photo_import quota)
	adminPushPerMin      = 5   // admin: send a push notification
	generalPerUserPerMin = 100 // everything else under /api
)

func NewRouter(d RouterDeps) *gin.Engine {
	r := gin.New()
	r.MaxMultipartMemory = 12 << 20
	// Only Caddy (docker network / localhost) may set X-Forwarded-For; otherwise clients
	// could spoof their IP and bypass the per-IP limit.
	_ = r.SetTrustedProxies([]string{"127.0.0.1", "::1", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"})

	ctx := d.Ctx
	if ctx == nil {
		ctx = context.Background()
	}
	authLimit := RateLimitByIP(NewRateLimiter(ctx, "auth", authPerIPPerMin, time.Minute))
	searchLimit := RateLimitByUser(NewRateLimiter(ctx, "search", aiPerUserPerMin, time.Minute))
	exampleLimit := RateLimitByUser(NewRateLimiter(ctx, "example", aiPerUserPerMin, time.Minute))
	storyLimit := RateLimitByUser(NewRateLimiter(ctx, "story", storyPerUserPerMin, time.Minute))
	translateLimit := RateLimitByUser(NewRateLimiter(ctx, "translate", aiPerUserPerMin, time.Minute))
	sharedLimit := RateLimitByIP(NewRateLimiter(ctx, "shared", sharedPerIPPerMin, time.Minute))
	importLimit := RateLimitByUser(NewRateLimiter(ctx, "shared-import", importPerUserPerMin, time.Minute))
	photoLimit := RateLimitByUser(NewRateLimiter(ctx, "photo-import", photoPerUserPerMin, time.Minute))
	adminPushLimit := RateLimitByUser(NewRateLimiter(ctx, "admin-push", adminPushPerMin, time.Minute))
	checkLimit := RateLimitByUser(NewRateLimiter(ctx, "word-check", checkPerUserPerMin, time.Minute))
	generalLimit := RateLimitByUserExcept(NewRateLimiter(ctx, "general", generalPerUserPerMin, time.Minute),
		"/api/search-word", "/api/words/generate-example", "/api/stories/generate", "/api/translations", "/api/words/check", "/api/photo-import")

	r.Use(
		Recovery(),
		otelgin.Middleware(d.ServiceName),
		RequestLogger(),
		NativeLang(),
		cors.New(cors.Config{
			AllowOrigins:     d.CORSOrigins,
			AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
			AllowHeaders:     []string{"Authorization", "Content-Type", NativeLanguageHeader},
			AllowCredentials: true,
			MaxAge:           12 * time.Hour,
		}),
	)

	r.GET("/healthz", func(c *gin.Context) {
		if d.HealthCheck != nil {
			if err := d.HealthCheck(); err != nil {
				c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unavailable"})
				return
			}
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	api := r.Group("/api")
	{
		// Public folder preview: no login, limited per IP.
		api.GET("/shared/:token", sharedLimit, d.Shared.Get)
		a := api.Group("/auth")
		a.POST("/register", authLimit, d.Auth.Register)
		a.POST("/login", authLimit, d.Auth.Login)
		a.POST("/refresh", d.Auth.Refresh)
		a.POST("/logout", d.Auth.Logout)
	}

	// ActiveUser re-checks ban/role in the DB on every authenticated request.
	protected := api.Group("", AuthRequired(d.Tokens), ActiveUser(d.UserStatus), generalLimit)
	{
		protected.POST("/contexts", d.Contexts.Create)
		protected.GET("/word-cards", d.Contexts.WordCards)
		protected.GET("/collection", d.Collection.List)
		protected.GET("/collection/ids", d.Collection.IDs)
		protected.DELETE("/word-cards/:id", d.Contexts.DeleteCard)
		protected.PATCH("/words/:id", d.WordEdit.Update)
		protected.POST("/words/move", d.WordMove.Move)
		protected.GET("/folders", d.Folders.List)
		protected.POST("/folders", d.Folders.Create)
		protected.PATCH("/folders/:id", d.Folders.Update)
		protected.DELETE("/folders/:id", d.Folders.Delete)
		protected.POST("/folders/:id/share", d.Folders.EnableShare)
		protected.POST("/folders/:id/share/regenerate", d.Folders.RegenerateShare)
		protected.DELETE("/folders/:id/share", d.Folders.DisableShare)
		protected.POST("/shared/:token/import", importLimit, d.Shared.Import)
		protected.POST("/search-word", searchLimit, d.Search.Search)
		protected.POST("/search-word/add", d.Search.Add)
		protected.POST("/photo-import", photoLimit, d.Photo.Import)
		protected.GET("/push/public-key", d.Push.PublicKey)
		protected.POST("/push/subscribe", d.Push.Subscribe)
		protected.DELETE("/push/subscribe", d.Push.Unsubscribe)
		protected.POST("/feedback", d.Feedback.Submit)
		protected.POST("/feedback/dismiss", d.Feedback.Dismiss)
		protected.POST("/words/generate-example", exampleLimit, d.Contexts.GenerateExample)
		protected.POST("/words/check", checkLimit, d.WordCheck.Check)
		protected.GET("/word-fixes", d.WordCheck.ListFixes)
		protected.POST("/word-fixes/:id/accept", d.WordCheck.AcceptFix)
		protected.POST("/word-fixes/:id/reject", d.WordCheck.RejectFix)
		protected.POST("/translations", translateLimit, d.Translations.Batch)
		protected.GET("/review/due", d.Review.Due)
		protected.POST("/review/:id/answer", d.Review.Answer)
		protected.GET("/practice/words", d.Practice.Words)
		protected.POST("/practice/:id/answer", d.Practice.Answer)
		protected.GET("/stats", d.Stats.Get)
		protected.GET("/stories", d.Stories.List)
		protected.GET("/stories/today", d.Stories.Today)
		protected.POST("/stories/generate", storyLimit, d.Stories.Generate)
		protected.GET("/stories/by-id/:id", d.Stories.ByID)
		protected.POST("/stories/own", storyLimit, d.Stories.CreateOwn)
		protected.PUT("/stories/own/:id", storyLimit, d.Stories.UpdateOwn)
		protected.DELETE("/stories/own/:id", d.Stories.DeleteOwn)
		protected.GET("/me/settings", d.Settings.Get)
		protected.PUT("/me/settings", d.Settings.Update)
		protected.GET("/me", d.Admin.Me)
		protected.GET("/hero", d.Hero.Get)
		protected.POST("/hero/stage-seen", d.Hero.StageSeen)
		protected.POST("/hero/intro-seen", d.Hero.IntroSeen)
	}

	// Every /api/admin/* route goes through AuthRequired + ActiveUser + RequireAdmin (role from the DB).
	admin := protected.Group("/admin", RequireAdmin())
	{
		admin.GET("/users", d.Admin.Users)
		admin.GET("/stats", d.Admin.Stats)
		admin.GET("/feedback", d.Admin.Feedback)
		admin.GET("/push", d.Push.AdminStats)
		admin.POST("/push", adminPushLimit, d.Push.AdminSend)
		admin.DELETE("/users/:id", d.Admin.DeleteUser)
		admin.PATCH("/users/:id/ban", d.Admin.Ban)
		admin.GET("/users/:id/features", d.Admin.UserFeatures)
		admin.PUT("/users/:id/features/:feature", d.Admin.SetUserFeature)
		admin.POST("/word-check", d.WordCheck.StartJob)
		admin.GET("/word-check", d.WordCheck.JobStatus)
	}
	return r
}
