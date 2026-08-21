// Package server builds the Fiber HTTP application: middleware stack and
// routes. It owns no lifecycle (listening, connecting) beyond wiring —
// that is main's job.
package server

import (
	"io"
	"runtime/debug"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/apilog"
	"github.com/vndee/tuhoc-api/internal/auth"
	"github.com/vndee/tuhoc-api/internal/config"
	"github.com/vndee/tuhoc-api/internal/course"
	"github.com/vndee/tuhoc-api/internal/stats"
	// appsync is internal/sync under an explicit alias, not its default
	// package name ("sync"): that name collides with the standard
	// library's own "sync" package (sync.Mutex etc.), and this file is
	// exactly the kind of place a future change could add a stdlib sync
	// import (e.g. for a WaitGroup) alongside it. Aliasing here means that
	// future addition can never silently collide — see internal/sync's
	// package doc comment for the full reasoning.
	appsync "github.com/vndee/tuhoc-api/internal/sync"
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
	// BodyLimit is raised from fiber's 4 MiB default because POST /courses
	// accepts a course package, and a legitimate one may be up to 20 MiB
	// of contents that barely compress (a course is mostly images once it
	// stops being mostly prose). course.MaxUploadBytes is that ceiling
	// plus room for zip and multipart framing.
	//
	// It is a per-APP setting in fiber v2, not a per-route one, so every
	// other route inherits it. That is a real, if small, widening: /sync
	// and /events/batch will now buffer a 21 MiB body before their
	// handlers reject it, where they used to be cut off at 4 MiB. The
	// alternative — leaving the limit at 4 MiB — would reject perfectly
	// valid packages at the transport layer with a message that says
	// nothing about packages, so the trade is made deliberately here
	// rather than discovered later by someone whose 6 MiB course would not
	// upload.
	//
	// This limit is NOT the package size rule and must never be mistaken
	// for it: it bounds the bytes on the wire, while the rule that matters
	// (course.MaxUncompressedBytes) bounds the bytes after expansion. A
	// zip bomb passes this one comfortably.
	app := fiber.New(fiber.Config{BodyLimit: int(course.MaxUploadBytes)})

	// Fiber's CORS middleware treats an empty AllowOrigins as the
	// wildcard "*", which it refuses to combine with AllowCredentials —
	// so a zero-value Config (as callers such as tests may construct
	// directly, bypassing config.Load's own defaulting) must still get a
	// safe, concrete origin here.
	corsOrigin := cfg.CORSOrigin
	if corsOrigin == "" {
		corsOrigin = config.DefaultCORSOrigin
	}

	// EnableStackTrace + an explicit StackTraceHandler, not the stock
	// `recover.New()`. A panic in a handler already becomes a 500 either
	// way; what the default config throws away is the ONLY thing that
	// makes such a 500 actionable — where it came from. (The middleware's
	// own default stack-trace handler also writes straight to os.Stderr,
	// outside whatever the rest of the process logs through, and is not
	// assertable from a test; routing it into apilog fixes both.)
	app.Use(recover.New(recover.Config{
		EnableStackTrace: true,
		StackTraceHandler: func(c *fiber.Ctx, e any) {
			apilog.Panic(c, e, debug.Stack())
		},
	}))
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

	// Sync routes (Task 7). These deliberately mount behind
	// auth.Require(deps.Pool) — the brief-mandated entry point named in
	// ruling F3 — rather than auth.RequireWithUsecase(authUsecase) as /me
	// does above: the task brief names auth.Require(pool) specifically as
	// the interface Task 7 depends on, so these routes are what actually
	// exercises that exact entry point (RequireWithUsecase is only an
	// internal optimization /me's own wiring uses to avoid building a
	// second, equivalent auth Usecase/Repo pair over the same pool).
	syncHandler := appsync.NewHandler(appsync.NewUsecase(appsync.NewRepo(deps.Pool)))
	app.Get("/sync", auth.Require(deps.Pool), syncHandler.Pull)
	app.Post("/sync", auth.Require(deps.Pool), syncHandler.Push)

	// Stats routes (Task 8). Mounted behind auth.Require(deps.Pool) — the
	// same brief-mandated entry point and ruling (F3) as sync's routes
	// above, exercised directly by stats_test.go's own 401 case.
	statsHandler := stats.NewHandler(stats.NewRepo(deps.Pool))
	app.Post("/events/batch", auth.Require(deps.Pool), statsHandler.EventsBatch)
	app.Get("/stats", auth.Require(deps.Pool), statsHandler.Stats)

	// Course routes. Behind auth.Require(deps.Pool) like every route
	// above, and for a sharper reason than most: every course.Repo method
	// is keyed on an owner id, and that id must come from the
	// authenticated session (auth.UID) — never from a request body, form
	// field, or query parameter. See handler.go.
	//
	// The manifest route is registered BEFORE the wildcard so it wins the
	// match. Both would serve the same bytes, but the explicit route is
	// the one the brief names as a contract, and leaving it implicit would
	// make it disappear the day the wildcard's shape changes.
	courseHandler := course.NewHandler(course.NewUsecase(course.NewRepo(deps.Pool)))
	app.Get("/courses", auth.Require(deps.Pool), courseHandler.List)
	app.Post("/courses", auth.Require(deps.Pool), courseHandler.Post)
	app.Get("/courses/:id/@:version/manifest.json", auth.Require(deps.Pool), courseHandler.Manifest)
	app.Get("/courses/:id/@:version/*", auth.Require(deps.Pool), courseHandler.Asset)

	return app
}
