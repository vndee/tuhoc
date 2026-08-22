package discuss

import (
	"context"
	"errors"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/vndee/tuhoc-api/internal/apilog"
	"github.com/vndee/tuhoc-api/internal/rating"
)

// Reason values are the closed vocabulary the front end switches on to say
// WHY there is nothing to show. They are stable strings, not prose: the
// sentence the reader sees is the web app's to write and to translate (the
// i18n gate in apps/web forbids hardcoded strings), and a message composed
// here would be an untranslatable Vietnamese sentence baked into a JSON
// body.
const (
	// ReasonOK — the thread loaded. Comments may still be empty; that is
	// "nobody has commented", not a failure, and the two must not look the
	// same to the reader.
	ReasonOK = ""
	// ReasonDisabled — no token or no repository is configured, so this
	// deployment has no Discussions at all. Normal today: there is no
	// public registry repository yet (docs/deploy.md §5c).
	ReasonDisabled = "disabled"
	// ReasonUnavailable — GitHub was asked and could not answer, or
	// answered something that did not survive the boundary check.
	ReasonUnavailable = "unavailable"
	// ReasonRateLimited — the platform's own ration was spent, so GitHub
	// was NOT asked. Distinct from unavailable on purpose: this one says
	// "try again shortly" and, unlike unavailable, it means no call left
	// this process.
	ReasonRateLimited = "rate_limited"
)

// Fetcher is the half of this package that touches the network. The
// handler holds the interface rather than *Client so a test can supply a
// fetcher that counts calls without a network, and so a nil fetcher is a
// legible "switched off" rather than a special case inside the client.
type Fetcher interface {
	Fetch(ctx context.Context, registryID string) (Thread, error)
	RepoURL() string
}

// threadResponse is GET /discussions/:registryId's wire shape.
//
// # IT IS THE SAME SHAPE WHETHER OR NOT ANYTHING LOADED
//
// Loaded flips, Reason fills in, Comments empties — but no field ever
// disappears and Comments is never null. That is the whole degradation
// strategy expressed in a struct: the front end has one shape to parse and
// one array to map over, on the good path and on all four bad ones, so
// there is no branch on which an undefined can reach a render.
type threadResponse struct {
	ID       string    `json:"id"`
	Loaded   bool      `json:"loaded"`
	Reason   string    `json:"reason"`
	URL      string    `json:"url"`
	Comments []Comment `json:"comments"`
}

// Handler serves the read-only Discussions embed.
type Handler struct {
	fetcher Fetcher
	cache   *Cache
	budget  *Budget
}

// NewHandler builds a Handler. fetcher may be nil, which switches the
// feature off: every request then answers 200 with loaded=false and
// reason=disabled. Passing nil is how an unconfigured deployment behaves,
// and it is deliberately not an error at start-up — see
// config.Config.GitHubToken.
func NewHandler(fetcher Fetcher, cache *Cache, budget *Budget) *Handler {
	return &Handler{fetcher: fetcher, cache: cache, budget: budget}
}

// NewHandlerForConfig builds the production Handler from the two
// environment values, and is the ONLY place allowed to turn a *Client into
// a Fetcher.
//
// That restriction exists because of a Go trap that would otherwise be
// invisible and permanent: NewClient returns a nil *Client to mean
// "switched off", and assigning a nil POINTER to an INTERFACE variable
// produces an interface that is not nil. `h.fetcher == nil` would then be
// false on an unconfigured deployment, Thread would call Fetch on a nil
// receiver, and the course page would answer 500 in exactly the situation
// the whole degradation strategy exists to handle — the default one. The
// explicit `if client != nil` below is what keeps that from happening, and
// TestUnconfiguredDeploymentDegrades is what keeps it from being deleted.
//
// An err here means the configuration is wrong (a repo that is not
// "owner/name"), which is a different thing from absent configuration and
// deserves to be seen — the caller logs it and runs with Discussions off
// rather than refusing to start, matching config.parseCookieSecure's
// treatment of a value that is set but unusable.
func NewHandlerForConfig(token, repo string) (*Handler, error) {
	client, err := NewClient(token, repo)
	if err != nil {
		return NewHandler(nil, NewCache(), NewBudget()), err
	}
	var fetcher Fetcher
	if client != nil {
		fetcher = client
	}
	return NewHandler(fetcher, NewCache(), NewBudget()), nil
}

// Thread handles GET /discussions/:registryId.
//
// # WHY EVERY ANSWER IS 200
//
// A course page must survive GitHub having a bad day. The plan names this
// exactly: failure degrades into "the discussion could not be loaded" and
// never breaks the page. A 5xx here would hand the web client's generic
// error path a failure it would be right to treat as fatal, and the section
// that cannot load would take the page with it — which is the shape of the
// blank-page defect (commit 815a472) reintroduced one layer up. "There is
// no discussion to show you right now" is a successful answer to the
// question that was asked, and Reason says which of the four cases it is.
//
// A malformed REQUEST is still a 400: that is this API's own client getting
// it wrong, not a third party being unavailable.
//
// # THE ORDER OF THE GATES IS THE POINT
//
//  1. validate the id      — never spend anything on a request that is wrong
//  2. feature switched on? — never spend anything when there is nothing to call
//  3. cache                — a hit costs zero outbound calls
//  4. budget               — REFUSE BEFORE CALLING, never after
//  5. call GitHub
//
// Step 4 before step 5 is not a style preference. Swapping them produces
// byte-identical responses in every case — same status, same body, same
// reason — while the number of requests that actually reach GitHub goes
// from the ration to the request rate. Subsystem 2 measured that exact
// mutant: identical 92 refusals, real calls 8 → 100. Which is why
// discuss_test.go counts requests arriving at a fake GitHub and never
// counts responses leaving here.
func (h *Handler) Thread(c *fiber.Ctx) error {
	// rating.RegistryID, not a copy of it. The plan is explicit that a
	// registry id is ONE definition shared with subsystem 3, and this
	// project has already paid for the alternative ("one rule, three
	// copies, disagreeing on 7 of 12 rows"). Importing the rule means
	// discussions and ratings can never disagree about what a course id
	// is; writing a second one here means they can, silently.
	//
	// strings.Clone is LOad-BEARING and was added after a measurement, not
	// out of caution. fiber hands out c.Params() as a zero-copy view over
	// the pooled request buffer, and url.PathUnescape returns its input
	// unchanged when there is nothing to unescape — so without the clone,
	// registryID is a window onto memory the next request overwrites. This
	// handler KEEPS that string: it is the cache key. When a later course
	// id of the same length lands in the same buffer slot, the stored key
	// silently starts reading as that id, and the cache answers a lookup it
	// should have missed.
	//
	// That is not a theory. Before this line existed, the 100-distinct-ids
	// case in discuss_test.go measured 97 real calls instead of 100, and
	// the request for "course-59" came back carrying "course-46"'s
	// comments — one course's discussion served under another course's id,
	// on a page that names the course. The three tests that would have gone
	// on passing were the ones asserting on the echoed id, because the
	// echoed id is taken from the CURRENT request and matches either way.
	//
	// internal/rating does the same c.Params() read and does NOT need this,
	// which is worth knowing before "tidying" it in: it passes the value
	// straight to pgx and never retains it past the handler. The rule is
	// about retention, not about c.Params.
	registryID, err := rating.RegistryID(strings.Clone(c.Params("registryId")))
	if err != nil {
		var reason *rating.InvalidRatingError
		detail := ""
		if errors.As(err, &reason) {
			detail = reason.Reason
		}
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":  "invalid course id",
			"detail": detail,
		})
	}

	if h.fetcher == nil {
		return h.reply(c, registryID, false, ReasonDisabled, "", nil)
	}

	if thread, ok, present := h.cache.Get(registryID); present {
		if !ok {
			// A remembered failure. Answering from it is the point: see
			// FailureTTL for what happens to everyone else's discussions
			// without it.
			return h.reply(c, registryID, false, ReasonUnavailable, h.fetcher.RepoURL(), nil)
		}
		return h.reply(c, registryID, true, ReasonOK, thread.URL, thread.Comments)
	}

	// BEFORE the call. Not after.
	if !h.budget.Take() {
		return h.reply(c, registryID, false, ReasonRateLimited, h.fetcher.RepoURL(), nil)
	}

	thread, err := h.fetcher.Fetch(c.Context(), registryID)
	if err != nil {
		// Logged, not returned: GitHub's error text can name repositories,
		// hosts and credentials states, and it is no business of a browser.
		// The reader gets a reason code; the operator gets the cause.
		apilog.Internal(c, "discuss.Thread", err)
		h.cache.Put(registryID, Thread{}, false)
		return h.reply(c, registryID, false, ReasonUnavailable, h.fetcher.RepoURL(), nil)
	}

	h.cache.Put(registryID, thread, true)
	return h.reply(c, registryID, true, ReasonOK, thread.URL, thread.Comments)
}

// reply writes the one response shape. Every exit from Thread goes through
// it, so there is no path on which Comments can be nil and no path on which
// a field is omitted — the guarantee threadResponse's comment makes is kept
// here rather than at five separate call sites.
func (h *Handler) reply(c *fiber.Ctx, id string, loaded bool, reason, url string, comments []Comment) error {
	if comments == nil {
		comments = []Comment{}
	}
	return c.Status(fiber.StatusOK).JSON(threadResponse{
		ID:       id,
		Loaded:   loaded,
		Reason:   reason,
		URL:      url,
		Comments: comments,
	})
}
