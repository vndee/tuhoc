// Package server builds the Fiber HTTP application: middleware stack and
// routes. It owns no lifecycle (listening, connecting) beyond wiring —
// that is main's job.
package server

import (
	"context"
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

	"github.com/vndee/tuhoc-api/internal/ai"
	"github.com/vndee/tuhoc-api/internal/apilog"
	"github.com/vndee/tuhoc-api/internal/auth"
	"github.com/vndee/tuhoc-api/internal/catalog"
	"github.com/vndee/tuhoc-api/internal/config"
	"github.com/vndee/tuhoc-api/internal/discuss"
	"github.com/vndee/tuhoc-api/internal/pkgcheck"
	"github.com/vndee/tuhoc-api/internal/rating"
	"github.com/vndee/tuhoc-api/internal/stats"
	"github.com/vndee/tuhoc-api/internal/userdata"
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

	// Sync route (Task 7; Pha 3 Task 3 cut GET /sync — see
	// internal/sync/handler.go's package note for why POST /sync alone
	// survives and for how long). It deliberately mounts behind
	// auth.Require(deps.Pool) — the brief-mandated entry point named in
	// ruling F3 — rather than auth.RequireWithUsecase(authUsecase) as /me
	// does above: the task brief names auth.Require(pool) specifically as
	// the interface Task 7 depends on, so this route is what actually
	// exercises that exact entry point (RequireWithUsecase is only an
	// internal optimization /me's own wiring uses to avoid building a
	// second, equivalent auth Usecase/Repo pair over the same pool).
	//
	// bodyLimit(appsync.MaxPushBytes) is mounted ahead of the auth
	// middleware: this route has no use for POST /courses's 21 MiB app
	// ceiling and never did, and putting the limit first means an
	// oversized body never reaches the pool.
	syncHandler := appsync.NewHandler(appsync.NewUsecase(appsync.NewRepo(deps.Pool)))
	app.Post("/sync", bodyLimit(appsync.MaxPushBytes), auth.Require(deps.Pool), syncHandler.Push)

	// Progress routes (Pha 3, Task 1). The REST replacement for the
	// progress half of /sync: the browser is no longer local-first, so
	// there is no outbox and no LWW timestamp for a client to carry — see
	// internal/userdata's own doc comment. Mounted behind the same
	// auth.Require(deps.Pool) entry point as every route below.
	userdataHandler := userdata.NewHandler(userdata.NewUsecase(userdata.NewRepo(deps.Pool)))
	app.Get("/progress", auth.Require(deps.Pool), userdataHandler.ListProgress)
	app.Put("/progress", auth.Require(deps.Pool), userdataHandler.PutProgress)

	// Annotation routes (Pha 3, Task 2). The REST replacement for the
	// annotations half of /sync, same non-local-first reasoning as
	// /progress above — plus a real DELETE, since migration 0009 dropped
	// annotations.deleted_at: this package never writes a tombstone,
	// unlike internal/sync's push path (see that package's repo.go for how
	// it now translates an incoming tombstone into a real delete instead).
	app.Get("/annotations", auth.Require(deps.Pool), userdataHandler.ListAnnotations)
	app.Post("/annotations", auth.Require(deps.Pool), userdataHandler.CreateAnnotation)
	app.Patch("/annotations/:id", auth.Require(deps.Pool), userdataHandler.PatchAnnotation)
	app.Delete("/annotations/:id", auth.Require(deps.Pool), userdataHandler.DeleteAnnotation)

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
	// The usecase is held in its own variable rather than inlined because
	// the AI routes below reuse it (through courseQuerier) — one usecase
	// over one repo over one pool, instead of a second equivalent stack
	// built just for the read_course tool.
	catalogUsecase := catalog.NewUsecase(catalog.NewRepo(deps.Pool))
	catalogHandler := catalog.NewHandler(catalogUsecase)

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

	// AI routes (Pha 2, Task 11): the server-side tutor. All three sit
	// behind auth.Require like every other stateful route in this file, and
	// they have to — a turn spends the platform's provider budget and the
	// learner's credit, and both are attributed to whoever the session says
	// is calling.
	//
	// The DeepSeek client, the search provider, and the credit service are
	// built ONCE and shared: they are stateless request-makers. The TOOLS
	// are not built here, on purpose — see ai.TurnTools, which the handler
	// calls per request because the web-search tool's per-turn budget is
	// counted on the instance, and one shared instance would turn "3
	// searches per turn" into "3 searches per process, for everyone".
	//
	// ai.NewProviderClient rather than ai.New: New takes an *http.Client,
	// and an hc carrying a Timeout re-imposes a total-request cutoff (body
	// reads included) underneath CompleteStream's idle/total watchdogs,
	// which is exactly what those watchdogs replaced. NewProviderClient has
	// no parameter for one, so this wiring cannot get it wrong.
	//
	// A deployment with no search key gets a nil provider, and web_search is
	// simply not registered — an advertised tool that always fails still
	// costs the learner a tool-call round to discover that.
	//
	// STARTUP SIGNAL (whole-branch review, A4). Both keys are read by
	// config.Load with a bare os.Getenv — no default, no complaint — and
	// cmd/api/main.go only ever insists on DATABASE_URL. Before these two
	// lines, a deployment that never set them booted perfectly clean and
	// then failed at the moment a learner pressed "Hỏi", reporting a
	// PROVIDER FAILURE. That is the wrong sentence for the situation: a
	// missing key is permanent and an operator fixes it in thirty seconds,
	// while a provider outage is temporary and an operator waits. Making
	// them indistinguishable costs whoever is on call the whole diagnosis.
	//
	// log.Printf and carry on, NOT log.Fatal: this mirrors the
	// "discussions disabled" line above exactly, and for the same reason —
	// the reader, the catalog, sync, stats and auth are all unaffected by a
	// missing AI key, so refusing to boot would turn a partial
	// misconfiguration into a total outage.
	//
	// The NAMES of the environment variables, never their values: the whole
	// point of provider_key_never_leaks_test.go is that a key does not
	// reach a log, and a helpful startup line is exactly where that rule
	// gets broken by accident.
	if cfg.DeepSeekAPIKey == "" {
		log.Printf("server: AI disabled: DEEPSEEK_API_KEY is not set — " +
			"POST /ai/chat will fail for every learner until it is")
	}
	var aiSearch ai.SearchProvider
	if cfg.BraveAPIKey != "" {
		aiSearch = ai.NewBrave(ai.DefaultBraveSearchEndpoint, cfg.BraveAPIKey, nil)
	} else {
		log.Printf("server: AI web search disabled: BRAVE_API_KEY is not set — " +
			"the web_search tool is not registered for any turn")
	}
	aiHandler := ai.NewHandler(ai.HandlerDeps{
		Client:  ai.NewProviderClient(cfg.DeepSeekBaseURL, cfg.DeepSeekAPIKey),
		Credits: ai.NewService(deps.Pool),
		Courses: courseQuerier{uc: catalogUsecase},
		Search:  aiSearch,
		// The learner is whoever the session cookie says, never anything in
		// the request. Passed in as a function because internal/auth imports
		// internal/ai (the signup grant), so internal/ai cannot import auth
		// back — and because stating it here keeps the decision visible at
		// the wiring site rather than buried in a struct field.
		UserID: auth.UID,
	})
	// bodyLimit ahead of auth.Require on both bodied routes, same ordering
	// and same reason as /sync and /events/batch above: an oversized body is
	// refused without spending a pool connection on validating a session.
	app.Post("/ai/chat", bodyLimit(ai.MaxChatBodyBytes), auth.Require(deps.Pool), aiHandler.Chat)
	app.Get("/ai/credits", auth.Require(deps.Pool), aiHandler.Credits)
	app.Get("/ai/config", auth.Require(deps.Pool), aiHandler.GetConfig)
	app.Put("/ai/config", bodyLimit(ai.MaxConfigBodyBytes), auth.Require(deps.Pool), aiHandler.PutConfig)

	// Admin AI routes (Task 17): the "Người dùng & credit" and "Bảng giá &
	// prompt nền" CMS screens (spec §7). Same admin gate Task 8's catalog
	// routes use — auth.Require then auth.RequireAdmin, in that order, the
	// order RequireAdmin's own doc comment requires — and nothing else:
	// unlike mountAdmin above, there is no adminOrToken door here, because
	// there is no CLI tool analogous to `tuhoc publish` that needs one. A
	// request that fails auth.Require gets 401; one that passes it but is
	// not an admin's gets 403 from auth.RequireAdmin, never a silent 404 —
	// see admin_handler_test.go's route-table-driven test in internal/ai,
	// which walks this exact group via app.Stack() rather than a hand-typed
	// list, so a route added here without updating that group is caught by
	// construction.
	adminAI := app.Group("/admin/ai", auth.Require(deps.Pool), auth.RequireAdmin(deps.Pool))
	adminAI.Get("/users", aiHandler.AdminListUsers)
	adminAI.Get("/users/:id", aiHandler.AdminGetUser)
	adminAI.Post("/users/:id/credit", aiHandler.AdminAdjustCredit)
	adminAI.Get("/pricing", aiHandler.AdminListPricing)
	adminAI.Put("/pricing/:model", aiHandler.AdminUpdatePricing)
	adminAI.Get("/settings", aiHandler.AdminGetSettings)
	adminAI.Put("/settings", aiHandler.AdminUpdateSettings)

	return app
}

// courseQuerier adapts internal/catalog's read side to the two-method
// surface the read_course tool needs (ai.CourseQuerier).
//
// It lives HERE, in the composition root, rather than in internal/ai, so
// that package keeps depending on nothing but the database and the two
// providers. internal/ai already sits underneath internal/auth in the import
// graph; giving it a second dependency on the whole catalog stack would put
// a domain package in the middle of the wiring, which is this file's job.
//
// Both methods reach only PUBLISHED courses — the same rows any anonymous
// reader can already fetch over GET /courses/:slug. The tool therefore adds
// no read authority the learner did not already have; what it adds is the
// model's ability to fetch them mid-answer.
type courseQuerier struct {
	uc *catalog.Usecase
}

func (q courseQuerier) Manifest(ctx context.Context, slug string) ([]byte, error) {
	course, err := q.uc.GetPublished(ctx, slug)
	if err != nil {
		return nil, err
	}
	return course.ManifestJSON, nil
}

func (q courseQuerier) ChapterHTML(ctx context.Context, slug, chapterID string) (string, error) {
	// Widgets and the version are dropped deliberately: a widget is an
	// interactive HTML island for a browser to render, and the model reads
	// prose. courseTool strips tags from what it gets back anyway.
	html, _, _, err := q.uc.GetChapter(ctx, slug, chapterID)
	return html, err
}
