// Package server builds the Fiber HTTP application: middleware stack and
// routes. It owns no lifecycle (listening, connecting) beyond wiring —
// that is main's job.
package server

import (
	"io"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/auth"
	"github.com/vndee/tuhoc-api/internal/config"
)

// authRateLimitMax and authRateLimitExpiration together define the
// request budget applied to every /auth/* route (register/login/logout),
// per the task 6 binding requirement. Deliberately not applied to /me:
// rate-limiting login/register specifically defends against credential-
// guessing and account-enumeration, and Require already gates /me behind
// a valid session.
const (
	authRateLimitMax        = 10
	authRateLimitExpiration = time.Minute
)

// Deps carries the shared dependencies handlers need.
type Deps struct {
	// Pool is the shared database pool auth (and later sync/stats)
	// handlers query through. It is nil when DATABASE_URL is unset (see
	// main.go / ruling F1) — /healthz keeps working without one, but any
	// route that touches the database, including all of /auth/* and
	// /me, needs it set.
	Pool *pgxpool.Pool
	// LogOutput is where the access logger writes. Nil means the
	// logger's own default (stdout) — the production behavior. Callers
	// that don't want request logs on stdout (tests) pass io.Discard
	// explicitly; the middleware stack itself is identical either way.
	LogOutput io.Writer
}

// New builds a Fiber app with the standard middleware stack (recover,
// logger, CORS) and the health check route.
func New(cfg config.Config, deps Deps) *fiber.App {
	app := fiber.New()

	// Fiber's CORS middleware treats an empty AllowOrigins as the
	// wildcard "*", which it refuses to combine with AllowCredentials —
	// so a zero-value Config (as callers such as tests may construct
	// directly, bypassing config.Load's own defaulting) must still get a
	// safe, concrete origin here.
	corsOrigin := cfg.CORSOrigin
	if corsOrigin == "" {
		corsOrigin = config.DefaultCORSOrigin
	}

	app.Use(recover.New())
	app.Use(logger.New(logger.Config{Output: deps.LogOutput}))
	app.Use(cors.New(cors.Config{
		AllowOrigins:     corsOrigin,
		AllowCredentials: true,
	}))

	app.Get("/healthz", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"ok": true})
	})

	// Auth routes (Task 6). deps.Pool may be nil when DATABASE_URL is
	// unset (see main.go / ruling F1) — that only matters once a request
	// actually reaches one of these handlers; wiring them up here is
	// always safe.
	//
	// authUsecase is built once and shared between authHandler and the
	// /me route's middleware below (via auth.RequireWithUsecase) so the
	// two don't each construct their own, equivalent Repo/Usecase pair
	// over the same pool.
	authUsecase := auth.NewUsecase(auth.NewRepo(deps.Pool))
	authHandler := auth.NewHandler(authUsecase, cfg.CookieSecure)

	authGroup := app.Group("/auth", limiter.New(limiter.Config{
		Max:        authRateLimitMax,
		Expiration: authRateLimitExpiration,
	}))
	authGroup.Post("/register", authHandler.Register)
	authGroup.Post("/login", authHandler.Login)
	authGroup.Post("/logout", authHandler.Logout)

	// GET /me is the first (and simplest) consumer of auth.Require —
	// mounting it behind the middleware here proves Require works end to
	// end, ahead of Task 7/8's routes depending on the same pattern.
	app.Get("/me", auth.RequireWithUsecase(authUsecase), authHandler.Me)

	return app
}
