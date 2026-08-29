package discuss

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// APIURL is where this client talks, written out in full, in source.
//
// It is a CONSTANT and not an environment variable, and that is a
// deliberate answer to a mutant the key-transit gate once named by hand:
// "a proxy that calls its field k and reads its base URL from an
// environment variable". A destination that lives in the environment is a
// destination no source scan can see.
//
// THE GATE THAT ONCE REQUIRED THIS IS GONE. internal/server/
// no_key_transit_test.go — whose outboundAllowlist is what let this file
// import net/http at all — was deleted at Task 11, and its successor
// provider_key_never_leaks_test.go deliberately does NOT replace the
// destination allowlist (see that file's PHẠM VI THẬT, point 3). Today
// nothing would stop this constant becoming a variable. It stays a constant
// anyway, and the reason above is still the reason.
//
// Tests override it through NewClientWithEndpoint, which takes the endpoint
// as an explicit argument at the call site rather than reading it from
// anywhere ambient.
const APIURL = "https://api.github.com/graphql"

// githubWebHost is the host every URL this package hands to a browser must
// be under. See decodeThread: a URL is the one field of GitHub's answer
// that ends up in an href, so it is the one field where "whatever the
// server said" is not an acceptable answer.
const githubWebHost = "https://github.com/"

// MaxComments is how many comments one thread returns. A course discussion
// with more than fifty comments is a link to GitHub, not an embed; the
// button that sends the reader there is always present.
const MaxComments = 50

// MaxResponseBytes caps how much of GitHub's answer this process will read
// into memory.
//
// Not a formality: without it, `io.ReadAll` on a third-party response is an
// unbounded allocation driven by somebody else's server, and the failure
// mode is the whole API dying rather than one course page losing its
// comments. Fifty comments of GitHub's own 65 536-character maximum, plus
// JSON framing, fits inside 4 MiB with room to spare.
const MaxResponseBytes int64 = 4 << 20

// RequestTimeout bounds one call to GitHub.
//
// The reader is waiting on a course page while this runs, so the question
// is not "how long might GitHub take" but "how long is this section of the
// page allowed to hold anything up". Eight seconds is past the point where
// a slow answer is worth having; after it the page says the discussion
// could not be loaded, which is the correct thing to say.
const RequestTimeout = 8 * time.Second

// deletedAuthor marks a comment whose author's account is gone. GitHub
// returns `author: null` for those, and that is a NORMAL answer rather than
// a malformed one — so it gets a sentinel instead of invalidating the whole
// thread.
//
// An EMPTY STRING, not a sentence. This package already decided that `reason`
// is a closed vocabulary and that `apps/web` owns the translated sentence;
// an author placeholder is the same kind of thing, and a Vietnamese sentence
// here would be the server deciding what language the reader speaks.
//
// The gate that caught this — `TestServerSpeaksNoVietnamese`, added by the
// i18n extraction running in parallel with this package — deliberately does
// NOT exclude packages by name, because excluding by name is exactly the
// blind gate `no_key_transit_test.go` rejected. It scanned a directory that
// did not exist when it was written, and found this on the first run.
//
// A login can never legitimately be empty, so the empty string cannot
// collide with a real author.
const deletedAuthor = ""

// ErrMalformed is returned when GitHub answered but the answer was not the
// shape this package requires. It is deliberately its own class, separate
// from a transport error, because the two are the same to a caller
// (degrade) and very different to whoever reads the log.
var ErrMalformed = errors.New("discuss: malformed response from GitHub")

// Comment is one comment on a course's discussion thread, after the
// boundary check.
//
// Body is GitHub's MARKDOWN SOURCE, not its rendered HTML, and that is a
// security decision rather than a formatting one: comments are written by
// members of the public, and GitHub's bodyHTML would arrive as markup this
// platform did not author and cannot vouch for, one dangerouslySetInnerHTML
// away from being executed on the reader's session. Text can be rendered
// safely by default; HTML cannot.
type Comment struct {
	ID        string `json:"id"`
	Author    string `json:"author"`
	Body      string `json:"body"`
	CreatedAt string `json:"createdAt"`
}

// Thread is one course's discussion, after the boundary check. A Thread
// that reached a caller has already been validated; there is no half-valid
// Thread.
type Thread struct {
	URL      string    `json:"url"`
	Comments []Comment `json:"comments"`
}

// Client reads Discussions from one, pinned GitHub repository.
type Client struct {
	http     *http.Client
	endpoint string
	token    string
	owner    string
	repo     string
}

// NewClient builds a Client for repo, given as "owner/name", talking to the
// real GitHub API.
//
// A nil Client is returned with no error when either argument is empty:
// that is the "Discussions are switched off" state, which is the normal
// state of every local checkout and of production until the registry
// repository exists (docs/deploy.md §5c). handler.go treats a nil fetcher
// as "not loaded" rather than as a failure.
func NewClient(token, repo string) (*Client, error) {
	return NewClientWithEndpoint(APIURL, token, repo)
}

// NewClientWithEndpoint is NewClient with the endpoint supplied at the call
// site. Production passes APIURL (see NewClient); tests pass an httptest
// server. Nothing reads an endpoint from the environment — see APIURL.
func NewClientWithEndpoint(endpoint, token, repo string) (*Client, error) {
	if token == "" || repo == "" {
		return nil, nil
	}
	owner, name, found := strings.Cut(repo, "/")
	if !found || owner == "" || name == "" || strings.Contains(name, "/") {
		return nil, fmt.Errorf("discuss: GITHUB_DISCUSSIONS_REPO must be \"owner/name\", got %q", repo)
	}
	return &Client{
		http:     &http.Client{Timeout: RequestTimeout},
		endpoint: endpoint,
		token:    token,
		owner:    owner,
		repo:     name,
	}, nil
}

// RepoURL is where the "post a comment" button sends the reader when there
// is no thread to link to. It is built from configuration, never from
// GitHub's answer, so it is safe to hand out even when nothing loaded.
func (c *Client) RepoURL() string {
	return githubWebHost + c.owner + "/" + c.repo + "/discussions"
}

// query finds one discussion by title inside one repository and returns its
// URL and first page of comments.
//
// The repository and the title both travel as GraphQL VARIABLES rather than
// being pasted into the document, so there is no GraphQL injection to worry
// about. What remains is GitHub SEARCH-syntax injection — a title
// containing `repo:` could aim the search at a different repository — and
// that is not defended by escaping (the syntax has no escaping worth
// trusting) but by checking the ANSWER: see decodeThread, which refuses any
// result whose URL is not under the configured repository. Verify the
// reply, do not trust the query.
const query = `query($q: String!, $comments: Int!) {
  search(query: $q, type: DISCUSSION, first: 1) {
    nodes {
      ... on Discussion {
        title
        url
        comments(first: $comments) {
          nodes { id author { login } body createdAt }
        }
      }
    }
  }
}`

// searchUnsafe reports whether id carries a character that means something
// to GitHub's search syntax.
//
// This is NOT a second copy of the registry id rule — it does not decide
// what a valid registry id is, and rating.RegistryID has already had that
// say by the time this runs. It decides what this package is willing to put
// inside a search query, which is a different question with a different
// owner. An id refused here degrades to "not loaded" rather than erroring:
// it is a real id, we simply cannot look it up this way.
func searchUnsafe(id string) bool {
	return strings.ContainsAny(id, " \t\n\r\v\f\"'():,")
}

// Fetch asks GitHub for the discussion thread whose title is registryID.
//
// Every failure — transport, status, GraphQL error, wrong shape, no such
// discussion — comes back as an error, and handler.go turns all of them
// into the same degraded answer. Nothing here returns a partially valid
// Thread.
func (c *Client) Fetch(ctx context.Context, registryID string) (Thread, error) {
	if searchUnsafe(registryID) {
		return Thread{}, fmt.Errorf("%w: course id %q cannot be looked up by search", ErrMalformed, registryID)
	}

	body, err := json.Marshal(map[string]any{
		"query": query,
		"variables": map[string]any{
			"q":        fmt.Sprintf("repo:%s/%s in:title %s", c.owner, c.repo, registryID),
			"comments": MaxComments,
		},
	})
	if err != nil {
		return Thread{}, fmt.Errorf("discuss: build query: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, RequestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return Thread{}, fmt.Errorf("discuss: build request: %w", err)
	}
	// This header carries the PLATFORM'S credential to GitHub, outbound.
	// It is the mirror image of the thing spec §1.4 forbids, which is this
	// server READING a credential a client sent IN — see
	// config.Config.GitHubToken for why the two are different in kind, and
	// note that the gate bans the header-READING call `c.Get(
	// "authorization")` and not the word Authorization, precisely so that
	// this distinction stays legible. That gate is now internal/server/
	// provider_key_never_leaks_test.go's keyBearingFields (the assertion was
	// carried over verbatim when no_key_transit_test.go was deleted at Task
	// 11).
	//
	// The line break inside that call is LOAD-BEARING, not formatting: the
	// scan matches the needle on ONE line, so writing it whole here would
	// make this comment trip the very gate it describes. Rephrasing is the
	// documented answer (handler.go's own "NAMING NOTE, load-bearing" in
	// internal/ai records five implementers who learned it the same way);
	// loosening the needle is not.
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return Thread{}, fmt.Errorf("discuss: call GitHub: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, MaxResponseBytes))
	if err != nil {
		return Thread{}, fmt.Errorf("discuss: read GitHub response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		// The body is NOT included: it is third-party text of unknown
		// length and content, and this string ends up in the server log.
		return Thread{}, fmt.Errorf("discuss: GitHub returned HTTP %d", resp.StatusCode)
	}

	return decodeThread(raw, c.owner, c.repo, registryID)
}

// graphQLReply is the wire shape, with every level a pointer so that
// "absent" and "present but empty" stay distinguishable. encoding/json
// silently leaves a missing field at its zero value, which is exactly how a
// malformed answer becomes an empty thread that looks like a real one.
type graphQLReply struct {
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
	Data *struct {
		Search *struct {
			Nodes []*struct {
				Title    *string `json:"title"`
				URL      *string `json:"url"`
				Comments *struct {
					Nodes []*struct {
						ID     *string `json:"id"`
						Author *struct {
							Login *string `json:"login"`
						} `json:"author"`
						Body      *string `json:"body"`
						CreatedAt *string `json:"createdAt"`
					} `json:"nodes"`
				} `json:"comments"`
			} `json:"nodes"`
		} `json:"search"`
	} `json:"data"`
}

// decodeThread is the BOUNDARY. Nothing from GitHub reaches the rest of
// this API without passing through it.
//
// It is the same discipline as assertStats in apps/web/src/api/stats.ts,
// and it is here for the same reason that one exists: a source returned
// something nobody expected, nobody checked it where it entered, and the
// consequence was a blank page (commit 4f2bf1f). assertStats's own comment
// records the follow-up lesson — guarding the call sites you thought of
// fixes the call sites you thought of, and the very next test found the one
// you did not. So this is ONE check, at the one place the data crosses in,
// and it covers every present and future consumer.
//
// What it insists on, and why each one:
//
//   - The body parses as JSON. An HTML error page served with a 200 by
//     something in the middle is a real GitHub failure mode.
//   - `errors` is empty. GitHub answers a failed GraphQL query with HTTP
//     200 and an errors array; treating that as success yields an empty
//     thread indistinguishable from a real, empty one.
//   - Every level down to the node exists. A null `data` or `search` is
//     what a permissions failure looks like.
//   - The title equals the id and the URL is under the configured
//     repository. This is what makes search-syntax injection inert (see
//     query), and it is also the check that keeps a URL this platform did
//     not authorise out of an href on the page.
//   - Every comment field is present and typed. A missing createdAt is a
//     date the front end cannot parse, which is the render crash this
//     whole file exists to prevent, one layer down.
//
// A thread with no matching discussion is an error, not an empty Thread:
// "nobody has commented yet" and "we could not find the discussion" are
// different sentences and the reader deserves the right one.
func decodeThread(raw []byte, owner, repo, registryID string) (Thread, error) {
	var reply graphQLReply
	if err := json.Unmarshal(raw, &reply); err != nil {
		return Thread{}, fmt.Errorf("%w: body is not the expected JSON: %v", ErrMalformed, err)
	}
	if len(reply.Errors) > 0 {
		// ANY error rejects the whole answer, including GraphQL's partial
		// failure — a 200 carrying a data block that looks complete plus an
		// errors array saying it is not. That is the case this check
		// actually exists for; a null data block is caught two lines below
		// without it.
		//
		// Stated as the trade-off it is: this is the STRICT reading. GitHub
		// sometimes reports an error about one field while the rest of the
		// answer is fine, and on those the reader sees "could not load"
		// instead of a thread that is 95% there. The alternative is
		// displaying an incomplete discussion as if it were complete, with
		// no way for the reader to know comments are missing, and between
		// "visibly unavailable" and "silently wrong" this package picks the
		// first. If real traffic shows this firing on healthy responses,
		// the fix is to narrow it by error type against MEASURED payloads —
		// not to delete it, which is what mutation testing showed leaves no
		// other check standing.
		//
		// GitHub's own message is included because it is the only thing
		// that distinguishes "bad credentials" from "repository not
		// found", and this string goes to the server log, never to a
		// response body.
		return Thread{}, fmt.Errorf("%w: GraphQL errors: %s", ErrMalformed, reply.Errors[0].Message)
	}
	if reply.Data == nil || reply.Data.Search == nil {
		return Thread{}, fmt.Errorf("%w: no data.search in the reply", ErrMalformed)
	}
	if len(reply.Data.Search.Nodes) == 0 || reply.Data.Search.Nodes[0] == nil {
		return Thread{}, fmt.Errorf("%w: no discussion matched", ErrMalformed)
	}

	node := reply.Data.Search.Nodes[0]
	if node.Title == nil || node.URL == nil {
		return Thread{}, fmt.Errorf("%w: discussion is missing title or url", ErrMalformed)
	}

	// The two checks that make a steered search inert. `in:title` is a
	// fuzzy match — GitHub will happily return a discussion whose title
	// merely contains the words — so equality here is also what stops one
	// course's thread being shown under another course's id.
	if *node.Title != registryID {
		return Thread{}, fmt.Errorf("%w: discussion title %q is not the course id %q", ErrMalformed, *node.Title, registryID)
	}
	wantPrefix := githubWebHost + owner + "/" + repo + "/discussions/"
	if !strings.HasPrefix(*node.URL, wantPrefix) {
		return Thread{}, fmt.Errorf("%w: discussion url is not under %s", ErrMalformed, wantPrefix)
	}

	out := Thread{
		URL: *node.URL,
		// Never nil. encoding/json renders a nil slice as `null`, and a
		// front end calling .map on it throws — the same defect class as
		// the missing field above, introduced on the way out instead of
		// on the way in.
		Comments: []Comment{},
	}
	if node.Comments == nil {
		return out, nil
	}

	for i, cm := range node.Comments.Nodes {
		if cm == nil {
			return Thread{}, fmt.Errorf("%w: comment %d is null", ErrMalformed, i)
		}
		if cm.ID == nil || cm.Body == nil || cm.CreatedAt == nil {
			return Thread{}, fmt.Errorf("%w: comment %d is missing id, body or createdAt", ErrMalformed, i)
		}
		if _, err := time.Parse(time.RFC3339, *cm.CreatedAt); err != nil {
			return Thread{}, fmt.Errorf("%w: comment %d has an unparseable createdAt", ErrMalformed, i)
		}
		author := deletedAuthor
		if cm.Author != nil && cm.Author.Login != nil {
			author = *cm.Author.Login
		}
		out.Comments = append(out.Comments, Comment{
			ID:        *cm.ID,
			Author:    author,
			Body:      *cm.Body,
			CreatedAt: *cm.CreatedAt,
		})
	}
	return out, nil
}
