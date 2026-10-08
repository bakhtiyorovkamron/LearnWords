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
	ServiceName string
	CORSOrigins []string
	Tokens      service.TokenManager
	Auth        *AuthHandler
	Contexts    *ContextHandler
	Review      *ReviewHandler
	Stats       *StatsHandler
	Stories     *StoryHandler
	Settings    *SettingsHandler
	Admin       *AdminHandler
	Collection  *CollectionHandler
	WordEdit    *WordEditHandler
	Folders     *FolderHandler
	Search      *SearchHandler
	UserStatus  UserStatusStore
	HealthCheck func() error
	// MediaDir is served read-only at /api/media (generated TTS audio).
	MediaDir string
	// Ctx stops the rate limiters' cleanup goroutines on shutdown.
	Ctx context.Context
}

// Rate limits (per minute). In-memory, per backend process.
const (
	authPerIPPerMin      = 10  // login/register, by IP
	aiPerUserPerMin      = 20  // search-word, generate-example
	storyPerUserPerMin   = 5   // daily story generation
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
	generalLimit := RateLimitByUserExcept(NewRateLimiter(ctx, "general", generalPerUserPerMin, time.Minute),
		"/api/search-word", "/api/words/generate-example", "/api/stories/generate")

	r.Use(
		Recovery(),
		otelgin.Middleware(d.ServiceName),
		RequestLogger(),
		cors.New(cors.Config{
			AllowOrigins:     d.CORSOrigins,
			AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
			AllowHeaders:     []string{"Authorization", "Content-Type"},
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
	if d.MediaDir != "" {
		// Public: <audio> can't send a bearer token; file names are random UUIDs.
		api.Static("/media", d.MediaDir)
	}
	{
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
		protected.GET("/contexts", d.Contexts.List)
		protected.DELETE("/contexts/:id", d.Contexts.DeleteContext)
		protected.GET("/contexts/:id/words", d.Contexts.Words)
		protected.PUT("/contexts/:id/photo", d.Contexts.SetPhoto)
		protected.GET("/word-cards", d.Contexts.WordCards)
		protected.GET("/collection", d.Collection.List)
		protected.POST("/word-cards/:id/audio", d.Contexts.RegenerateAudio)
		protected.DELETE("/word-cards/:id", d.Contexts.DeleteCard)
		protected.PATCH("/words/:id", d.WordEdit.Update)
		protected.GET("/folders", d.Folders.List)
		protected.POST("/folders", d.Folders.Create)
		protected.PATCH("/folders/:id", d.Folders.Update)
		protected.DELETE("/folders/:id", d.Folders.Delete)
		protected.POST("/search-word", searchLimit, d.Search.Search)
		protected.POST("/search-word/add", d.Search.Add)
		protected.POST("/words/generate-example", exampleLimit, d.Contexts.GenerateExample)
		protected.GET("/review/due", d.Review.Due)
		protected.POST("/review/:id/answer", d.Review.Answer)
		protected.GET("/stats", d.Stats.Get)
		protected.GET("/stories", d.Stories.List)
		protected.GET("/stories/today", d.Stories.Today)
		protected.POST("/stories/generate", storyLimit, d.Stories.Generate)
		protected.GET("/stories/:date", d.Stories.ByDate)
		protected.GET("/me/settings", d.Settings.Get)
		protected.PUT("/me/settings", d.Settings.Update)
		protected.GET("/me", d.Admin.Me)
	}

	// Every /api/admin/* route goes through AuthRequired + ActiveUser + RequireAdmin (role from the DB).
	admin := protected.Group("/admin", RequireAdmin())
	{
		admin.GET("/users", d.Admin.Users)
		admin.GET("/stats", d.Admin.Stats)
		admin.DELETE("/users/:id", d.Admin.DeleteUser)
		admin.PATCH("/users/:id/ban", d.Admin.Ban)
	}
	return r
}
