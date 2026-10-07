package handler

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// RateLimiter is an in-memory token-bucket limiter keyed by a string (IP or user id).
// Each key gets `limit` tokens refilled evenly over `window`; idle keys are evicted after
// 2*window so memory stays bounded. Limits are per backend process — swap for a
// Redis-backed implementation when running several instances.
type RateLimiter struct {
	name   string
	limit  float64
	rate   float64 // tokens per second
	ttl    time.Duration
	mu     sync.Mutex
	bucket map[string]*tokenBucket
}

type tokenBucket struct {
	tokens float64
	last   time.Time
}

// NewRateLimiter allows `limit` requests per `window` per key; cleanup stops when ctx is done.
func NewRateLimiter(ctx context.Context, name string, limit int, window time.Duration) *RateLimiter {
	rl := &RateLimiter{
		name:   name,
		limit:  float64(limit),
		rate:   float64(limit) / window.Seconds(),
		ttl:    2 * window,
		bucket: make(map[string]*tokenBucket),
	}
	go rl.cleanup(ctx)
	return rl
}

// Allow consumes one token for key; if none is left it returns false and how long to wait.
func (rl *RateLimiter) Allow(key string, now time.Time) (bool, time.Duration) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	b, ok := rl.bucket[key]
	if !ok {
		b = &tokenBucket{tokens: rl.limit, last: now}
		rl.bucket[key] = b
	} else {
		b.tokens = math.Min(rl.limit, b.tokens+now.Sub(b.last).Seconds()*rl.rate)
		b.last = now
	}
	if b.tokens >= 1 {
		b.tokens--
		return true, 0
	}
	return false, time.Duration((1 - b.tokens) / rl.rate * float64(time.Second))
}

func (rl *RateLimiter) cleanup(ctx context.Context) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-t.C:
			rl.mu.Lock()
			for k, b := range rl.bucket {
				if now.Sub(b.last) > rl.ttl {
					delete(rl.bucket, k)
				}
			}
			rl.mu.Unlock()
		}
	}
}

type rateLimitResponse struct {
	Error             string `json:"error"`
	Message           string `json:"message"`
	RetryAfterSeconds int    `json:"retry_after_seconds"`
}

func tooManyRequests(c *gin.Context, wait time.Duration) {
	secs := int(math.Ceil(wait.Seconds()))
	if secs < 1 {
		secs = 1
	}
	c.Header("Retry-After", strconv.Itoa(secs))
	c.AbortWithStatusJSON(http.StatusTooManyRequests, rateLimitResponse{
		Error:             "rate_limit_exceeded",
		Message:           fmt.Sprintf("Слишком много запросов. Попробуйте через %d секунд.", secs),
		RetryAfterSeconds: secs,
	})
}

// RateLimitByIP limits by client IP (unauthenticated routes: login/register).
func RateLimitByIP(rl *RateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		if ok, wait := rl.Allow(rl.name+":"+c.ClientIP(), time.Now()); !ok {
			tooManyRequests(c, wait)
			return
		}
		c.Next()
	}
}

// RateLimitByUser limits by the authenticated user id (must run after AuthRequired).
func RateLimitByUser(rl *RateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		if ok, wait := rl.Allow(rl.name+":"+userID(c).String(), time.Now()); !ok {
			tooManyRequests(c, wait)
			return
		}
		c.Next()
	}
}

// RateLimitByUserExcept is the general per-user limit; routes in skip (gin full paths such as
// "/api/search-word") have their own stricter limiter and are not counted here.
func RateLimitByUserExcept(rl *RateLimiter, skip ...string) gin.HandlerFunc {
	skipped := make(map[string]bool, len(skip))
	for _, p := range skip {
		skipped[p] = true
	}
	limit := RateLimitByUser(rl)
	return func(c *gin.Context) {
		if skipped[c.FullPath()] {
			c.Next()
			return
		}
		limit(c)
	}
}
