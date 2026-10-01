package handler

import (
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
	HealthCheck func() error
}

func NewRouter(d RouterDeps) *gin.Engine {
	r := gin.New()
	r.MaxMultipartMemory = 12 << 20

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
	{
		a := api.Group("/auth")
		a.POST("/register", d.Auth.Register)
		a.POST("/login", d.Auth.Login)
		a.POST("/refresh", d.Auth.Refresh)
		a.POST("/logout", d.Auth.Logout)
	}

	protected := api.Group("", AuthRequired(d.Tokens))
	{
		protected.POST("/contexts", d.Contexts.Create)
		protected.GET("/contexts", d.Contexts.List)
		protected.DELETE("/contexts/:id", d.Contexts.DeleteContext)
		protected.GET("/contexts/:id/words", d.Contexts.Words)
		protected.PUT("/contexts/:id/photo", d.Contexts.SetPhoto)
		protected.GET("/word-cards", d.Contexts.WordCards)
		protected.POST("/word-cards/:id/audio", d.Contexts.RegenerateAudio)
		protected.DELETE("/word-cards/:id", d.Contexts.DeleteCard)
		protected.POST("/words/generate-example", d.Contexts.GenerateExample)
		protected.GET("/review/due", d.Review.Due)
		protected.POST("/review/:id/answer", d.Review.Answer)
	}
	return r
}
