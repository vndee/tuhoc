// Package server builds the Fiber HTTP application: middleware stack and
// routes. It owns no lifecycle (listening, connecting) beyond wiring —
// that is main's job.
package server

import (
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/config"
)

// Deps carries the shared dependencies handlers need. Pool is nil in this
// task (no package owns a store yet); Task 5 wires it in.
type Deps struct {
	Pool *pgxpool.Pool
}

// defaultCORSOrigin is used when cfg.CORSOrigin is unset. Fiber's CORS
// middleware treats an empty AllowOrigins as the wildcard "*", which it
// refuses to combine with AllowCredentials — so New cannot pass an empty
// origin through untouched (config.Load already defaults it, but New must
// stay safe for callers, e.g. tests, that construct config.Config directly).
const defaultCORSOrigin = "http://localhost:5173"

// New builds a Fiber app with the standard middleware stack (recover,
// logger, CORS) and the health check route.
func New(cfg config.Config, deps Deps) *fiber.App {
	app := fiber.New()

	corsOrigin := cfg.CORSOrigin
	if corsOrigin == "" {
		corsOrigin = defaultCORSOrigin
	}

	app.Use(recover.New())
	// The access logger writes straight to stdout on every request; under
	// `go test` that pollutes test output, so it's skipped there. It stays
	// mounted for every real (non-test) run of the binary.
	if !testing.Testing() {
		app.Use(logger.New())
	}
	app.Use(cors.New(cors.Config{
		AllowOrigins:     corsOrigin,
		AllowCredentials: true,
	}))

	app.Get("/healthz", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"ok": true})
	})

	return app
}
