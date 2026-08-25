// Package server builds the Fiber HTTP application: middleware stack and
// routes. It owns no lifecycle (listening, connecting) beyond wiring —
// that is main's job.
package server

import (
	"crypto/subtle"
	"io"
	"log"
	"runtime/debug"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/apilog"
	"github.com/vndee/tuhoc-api/internal/auth"
	"github.com/vndee/tuhoc-api/internal/catalog"
	"github.com/vndee/tuhoc-api/internal/config"
	"github.com/vndee/tuhoc-api/internal/discuss"
	"github.com/vndee/tuhoc-api/internal/pkgcheck"
	"github.com/vndee/tuhoc-api/internal/rating"
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

// bodyLimit refuses a request whose body is larger than max, one route at
// a time.
//
// fiber v2's own BodyLimit is an APP setting, and PUT /admin/courses/:slug
// needs a far larger one than anything else here — so without this, every
// route inherits the package-upload ceiling. A review measured the
// widening on the two endpoints that got it by accident: the items one
// request could carry went from ~39 303 to ~204 919 (5.21×).
//
// It is mounted BEFORE auth.Require on the routes that use it, so an
// oversized body is refused without spending a pool connection on
// validating a session — the pool being the resource the oversized
// request was going to monopolize anyway.
//
// What it cannot do, stated plainly: fasthttp has already read the body
// into memory by the time any middleware runs, so this bounds what the
// HANDLER does with the bytes, not what the transport buffers. Making
// that limit itself per-route means a second fiber app on a second
// listener; the per-request amplification (~20× the wire size, in
// BodyParser) is what this actually removes, and the item caps in
// sync/stats remove the rest.
func bodyLimit(max int64) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if n := int64(len(c.Body())); n > max {
			return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{
				"error": "request body is too large for this endpoint",
			})
		}
		return c.Next()
	}
}

// bearerToken extracts the token from an "Authorization: Bearer <token>"
// header, or reports ok=false if the header is absent or a different
// scheme.
func bearerToken(c *fiber.Ctx) (token string, ok bool) {
	const prefix = "Bearer "
	h := c.Get(fiber.HeaderAuthorization)
	if !strings.HasPrefix(h, prefix) {
		return "", false
	}
	return strings.TrimPrefix(h, prefix), true
}

// adminTokenMatches is the one comparison the whole admin-token path rests
// on, pulled out as its own pure function so the property that actually
// matters — an EMPTY configured token must never match, no matter what a
// client sends — is directly unit-testable (see admin_gate_test.go)
// without needing to reproduce a real HTTP request that carries a
// zero-length Bearer token. That reproduction turns out to be its own
// trap: fasthttp trims trailing OWS from header VALUES while parsing (a
// request literally spelling "Authorization: Bearer " arrives at
// bearerToken as "Bearer", six bytes, no trailing space, which does not
// even match bearerToken's own prefix and never reaches this function at
// all) — a fact about fasthttp's parser, not a guarantee this function
// gets to lean on. If bearerToken ever became more lenient (trimming the
// scheme more loosely, accepting a lowercase "bearer", …) an empty
// suppliedToken could reach here for real, so the guard has to hold on
// its own terms.
//
// configuredToken == "" is checked FIRST and is NOT folded into the
// ConstantTimeCompare call below: subtle.ConstantTimeCompare(a, b) returns
// 1 when len(a) == len(b) and every byte matches, and two EMPTY slices
// satisfy both conditions trivially. Without this guard, a checkout that
// has simply never set ADMIN_TOKEN (the documented default — see
// config.Config.AdminToken) would treat a client supplying an empty token
// as admin-authenticated. An unset token must mean this path is OFF,
// never "matches the empty string".
func adminTokenMatches(configuredToken, suppliedToken string) bool {
	if configuredToken == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(suppliedToken), []byte(configuredToken)) == 1
}

// adminOrToken is the outer gate on every /admin/courses* route: a request
// carrying a Bearer token that matches cfg.AdminToken skips straight to
// the route's own handler (the CLI path — Task 4's `tuhoc publish` sends
// exactly this header); anything else falls back to a real admin session,
// checked by the SAME auth.Require + auth.RequireAdmin pair every other
// session-gated route in this file already uses.
//
// next is that route's terminal handler, called DIRECTLY (a plain Go
// function call) on the token path rather than via c.Next(). This is
// deliberate, not a shortcut: fiber's Ctx.Next() advances exactly one
// position through the REGISTERED handler chain (c.indexHandler++, then
// invoke c.route.Handlers[c.indexHandler] — see gofiber/fiber/v2's own
// ctx.go), and there is no public API to skip ahead by more than one step.
// A route registered as [adminOrToken, auth.Require, auth.RequireAdmin,
// handler] means calling auth.Require's closure directly from inside
// adminOrToken (rather than letting fiber invoke it) would still trigger
// ITS internal c.Next(), which — because c.indexHandler is a single
// counter shared by the whole chain, not scoped to whoever calls Next() —
// would jump straight to auth.RequireAdmin, and RequireAdmin's own
// c.Next() would jump straight to handler, silently skipping nothing on
// the failure path but running every step out of the order this comment
// describes on the success path. Calling next(c) directly sidesteps the
// counter entirely: a terminal route handler never calls c.Next() itself
// (every handler in this file just returns a response), so invoking it
// out of its registered position is safe, and it is the only way for the
// token path to reach the handler WITHOUT running auth.Require or
// auth.RequireAdmin at all — which is the point, since a token-authenticated
// request has no session cookie to validate in the first place.
func adminOrToken(cfg config.Config, next fiber.Handler) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if tok, ok := bearerToken(c); ok && adminTokenMatches(cfg.AdminToken, tok) {
			catalog.MarkTokenActor(c)
			return next(c)
		}
		return c.Next()
	}
}

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
	// BodyLimit is raised from fiber's 4 MiB default because
	// PUT /admin/courses/:slug accepts a course package, and a legitimate
	// one may be up to 20 MiB of contents that barely compress (a course
	// is mostly images once it stops being mostly prose). pkgcheck.
	// MaxUploadBytes is that ceiling plus room for zip framing — the same
	// constant catalog.Handler.Publish itself checks the body against (see
	// that method), so there is one number, not two that could drift.
	//
	// This used to be internal/course's own MaxUploadBytes, back when the
	// route that needed the wide ceiling was POST /courses (an
	// authenticated user's private import). Task 9 deleted that route along
	// with the per-user package store; the wide ceiling still exists for
	// the same underlying reason — a course package's contents can be
	// 20 MiB — it is just PUT /admin/courses/:slug that needs it now, and
	// pkgcheck (Tasks 6-7's validation gate, which both the CLI and this
	// server import) is where that number is defined today.
	//
	// It is a per-APP setting in fiber v2, not a per-route one, so every
	// other route would inherit it. This comment once called that "a real,
	// if small, widening" and left it there; a review measured it and the
	// word that did not survive was "small". /sync and /events/batch went
	// from ~39 303 items per request to ~204 919 (5.21×), with a body
	// swallowed whole into RAM at ~20× its size on the wire, no cap on
	// items in either handler, and every item one tx.Exec inside a single
	// transaction holding one of the pool's four to eight connections —
	// while every route, /healthz aside, needs that pool merely to check a
	// session cookie.
	//
	// So the app ceiling stays high for the one route that needs it, and
	// the two that do not get their old 4 MiB back through the bodyLimit
	// middleware above (appsync.MaxPushBytes, stats.MaxBatchBytes) plus a
	// cap on ITEMS, which is the bound the byte limit cannot supply.
	//
	// This limit is NOT the package size rule and must never be mistaken
	// for it: it bounds the bytes on the wire, while the rule that matters
	// (pkgcheck.MaxUncompressedBytes) bounds the bytes after expansion. A
	// zip bomb passes this one comfortably — pkgcheck.Validate is what
	// actually stops it, during decompression.
	app := fiber.New(fiber.Config{BodyLimit: int(pkgcheck.MaxUploadBytes)})

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
	//
	// POST carries bodyLimit(appsync.MaxPushBytes) ahead of the auth
	// middleware: this route has no use for POST /courses's 21 MiB app
	// ceiling and never did, and putting the limit first means an
	// oversized body never reaches the pool. GET has no body to limit.
	syncHandler := appsync.NewHandler(appsync.NewUsecase(appsync.NewRepo(deps.Pool)))
	app.Get("/sync", auth.Require(deps.Pool), syncHandler.Pull)
	app.Post("/sync", bodyLimit(appsync.MaxPushBytes), auth.Require(deps.Pool), syncHandler.Push)

	// Stats routes (Task 8). Mounted behind auth.Require(deps.Pool) — the
	// same brief-mandated entry point and ruling (F3) as sync's routes
	// above, exercised directly by stats_test.go's own 401 case.
	statsHandler := stats.NewHandler(stats.NewRepo(deps.Pool))
	app.Post("/events/batch", bodyLimit(stats.MaxBatchBytes), auth.Require(deps.Pool), statsHandler.EventsBatch)
	app.Get("/stats", auth.Require(deps.Pool), statsHandler.Stats)

	// Rating routes. Behind auth.Require(deps.Pool) like every route
	// above, and for a sharp reason of its own: the voter on every write is
	// auth.UID(c), never a body field, query parameter, or header.
	// rating.Repo.Put takes the user id as an argument so that decision is
	// made in the open here rather than inside a struct literal. See
	// internal/rating/handler.go.
	//
	// GET /ratings deliberately has no "everything" form: it answers only
	// about the ids the caller names, which is what keeps a private course
	// out of every listing. A route added here that enumerates ratings
	// would undo that in one line — read the handler's List comment before
	// adding one.
	//
	// bodyLimit is not mounted: the body is one small JSON object, and
	// fiber's app-wide ceiling (raised for PUT /admin/courses/:slug) is not
	// a meaningful bound on it. The bound that matters for this endpoint is
	// rating.MaxRatingsPerUser, which caps rows rather than bytes —
	// registry_id has no foreign key, so an account could otherwise write
	// unboundedly many rows by inventing ids.
	ratingHandler := rating.NewHandler(rating.NewUsecase(rating.NewRepo(deps.Pool)))
	app.Get("/ratings", auth.Require(deps.Pool), ratingHandler.List)
	app.Put("/ratings/:registryId", auth.Require(deps.Pool), ratingHandler.Put)

	// Discussions. Read-only: this API never writes to GitHub, and the
	// "post a comment" button in the web client is a link to github.com,
	// not a route here. There is deliberately no POST to add.
	//
	// Behind auth.Require like everything else, and here for a reason of
	// its own: the GitHub token is the PLATFORM'S, so the quota it spends
	// is shared by every reader (see discuss/cache.go's Budget). Requiring
	// a session does not make that ration per-user — it is global, and it
	// must be — but it does keep an anonymous flood from spending it.
	//
	// A misconfigured GITHUB_DISCUSSIONS_REPO is logged and the feature
	// runs switched off rather than aborting start-up. Discussions are one
	// section of one page; refusing to boot the whole API over them would
	// convert a cosmetic misconfiguration into an outage, which is the
	// same trade this package makes everywhere else.
	discussHandler, err := discuss.NewHandlerForConfig(cfg.GitHubToken, cfg.GitHubDiscussionsRepo)
	if err != nil {
		log.Printf("server: discussions disabled: %v", err)
	}
	app.Get("/discussions/:registryId", auth.Require(deps.Pool), discussHandler.Thread)

	// catalogHandler serves both the admin write routes (Task 8) and the
	// public read routes (Task 9) below — one handler over one usecase
	// over one repo, per this file's own "extend the layer, don't split
	// it" convention (see internal/catalog's own package doc).
	catalogHandler := catalog.NewHandler(catalog.NewUsecase(catalog.NewRepo(deps.Pool)))

	// Public course-reading routes (Task 9): no auth in front of any of
	// them — courses are free and public to read, spec §2.4's own decision.
	//
	// This is the ONLY reader-facing meaning "/courses" has left. Until
	// this commit, GET /courses/POST /courses/GET .../manifest.json and
	// GET .../@:version/* belonged to internal/course — a per-user package
	// store, gated behind auth.Require, keyed on owner_id. That package,
	// its table (course_packages), and the routes below are deleted
	// together in this commit (see the commit message for why: readers no
	// longer import a private copy, so there is nothing left for any of it
	// to protect). Three of these four routes were already mounted, and
	// already tested end to end, in the commit before this one; GET
	// /courses itself could not be, because fiber dispatches an identical
	// (method, path) pair to whichever route was registered FIRST — the
	// OLD private listing claimed that exact path — so PublicList's real
	// wiring waits for the old route's removal right here, in the same
	// commit.
	app.Get("/courses", catalogHandler.PublicList)
	app.Get("/courses/:slug", catalogHandler.PublicManifest)
	app.Get("/courses/:slug/chapters/:chapterId", catalogHandler.PublicChapter)
	app.Get("/courses/:slug/assets/*", catalogHandler.PublicAsset)

	// Admin catalog routes (Task 8): publish/unpublish/rollback/list for
	// the public catalog Task 9 serves reads from. Every route is mounted
	// behind adminOrToken, whose own doc comment explains the four-handler
	// chain shape below and why the token path calls its terminal handler
	// directly instead of relying on fiber's c.Next().
	//
	// PUT and DELETE share the path "/admin/courses/:slug" — legal in
	// fiber, since routes are keyed by (method, path) together, not path
	// alone.
	mountAdmin := func(method, path string, handler fiber.Handler) {
		app.Add(method, path,
			adminOrToken(cfg, handler),
			auth.Require(deps.Pool),
			auth.RequireAdmin(deps.Pool),
			handler)
	}
	mountAdmin(fiber.MethodPut, "/admin/courses/:slug", catalogHandler.Publish)
	mountAdmin(fiber.MethodGet, "/admin/courses", catalogHandler.List)
	mountAdmin(fiber.MethodDelete, "/admin/courses/:slug", catalogHandler.Unpublish)
	mountAdmin(fiber.MethodPost, "/admin/courses/:slug/rollback", catalogHandler.Rollback)

	return app
}
