# Deploying tuhoc

A from-scratch runbook for the three pieces of this platform:

| Piece | What it is | Where it runs |
|---|---|---|
| `apps/web` + `courses/*` + `packages/course-kit` | Static SPA bundle | Cloudflare Pages |
| `apps/api` | Go binary, `scratch`-based container | One container on Render (recommended) or Fly.io |
| Schema + user data | Postgres | Neon (free tier) |

**A deploy ships NO course content at all, and `dist/courses/` is never
created.** Since task 11 no course lives in this repo, and since the server-side
pivot (`docs/superpowers/specs/2026-08-25-server-side-pivot.md`) a reader gets a
course from Postgres through `apps/api` — not from a `.zip` they import, and not
from a directory the build copies. `courseAssets.ts` used to copy `courses/` into
`dist/courses/` (filtered to this repo's own public sample packages); commit
dafd4eb removed that copy outright rather than narrowing it further, because any
course content sitting next to the SPA bundle is a second, unsynced source of
truth on the origin that holds the session cookie. What the build still copies is
`course-kit/` — KaTeX and the reader runtime, which every chapter's rendering
loads as classic `<script src>` includes regardless of where the chapter HTML
came from. `make courses` is unaffected and still needed locally, for the handful
of unit/dev/e2e paths that read a package straight off disk.

Config files this doc walks through:

- `apps/api/fly.toml` — Fly.io app config
- `render.yaml` (repo root) — Render Blueprint
- `apps/web/wrangler.toml` — Cloudflare Pages project config
- `.env.example` (repo root) — every env var either side reads
- `apps/web/public/_redirects` — Pages SPA fallback (ships inside `dist/`)

Every command below was actually run against a local stand-in (a throwaway Postgres container, `docker build`, `bun run build`, `flyctl`/`wrangler` CLIs) unless marked **[unverified — needs a live account]**. See task-16-report.md for the raw exit codes.

---

## 0. Read this first: the domain decision

This section drives several other decisions below (`CORS_ORIGIN`, whether to buy a domain), so read it before creating any accounts.

### The problem

The web app and the API are, by design, two different origins (`apps/web/src/api/client.ts` prefixes every request with `VITE_API_URL`, and sends `credentials: 'include'` on every `fetch`). The session cookie the API sets is:

```go
// apps/api/internal/auth/handler.go
c.Cookie(&fiber.Cookie{
    Name:     CookieName,
    ...
    HTTPOnly: true,
    Secure:   h.cookieSecure,       // from COOKIE_SECURE
    SameSite: fiber.CookieSameSiteLaxMode,  // hardcoded, not configurable
})
```

`SameSite=Lax` is not "cross-origin never works" — it is **"cross-*site*-fetch never works."** Browsers scope `SameSite` to the registrable domain (`eTLD+1`), not the origin. Two different subdomains of the *same* registrable domain (e.g. `app.example.com` and `api.example.com`) are different **origins** but the same **site**, so `SameSite=Lax` cookies flow normally between them on ordinary `fetch`/XHR calls. Two genuinely different registrable domains (e.g. `tuhoc-web.pages.dev` and `tuhoc-api.onrender.com`) are cross-*site*, and `SameSite=Lax` cookies are **not attached** to a cross-site `fetch`/XHR request — only to a top-level navigation. This app never does a top-level navigation to the API; every call is a `fetch`. So on the free default hostnames, **login would appear to succeed (the `Set-Cookie` from `/auth/login` arrives fine), but every subsequent call — `GET /me`, `/sync`, `/events/batch`, `/stats` — would silently not carry the cookie and come back 401.** This is not a hypothetical edge case; it is the exact request pattern this app makes on every authenticated screen.

### The decision

**Use a custom domain with the web app and the API as subdomains of the same apex** (e.g. `app.yourdomain.com` for Pages, `api.yourdomain.com` for Render/Fly). This keeps them same-*site*, so the existing `SameSite=Lax` cookie code works exactly as written — **no code change required.** Both Cloudflare Pages and Render/Fly support custom domains on their free tiers at no extra cost; the only cost is owning the domain itself (typically ~$10–15/yr), which is outside "free infrastructure" but is a one-time/annual cost, not a hosting bill.

- `CORS_ORIGIN` (API) → `https://app.yourdomain.com` (exact origin: scheme + host, no trailing slash, no path — never a wildcard, since the API sends `Access-Control-Allow-Credentials: true` and Fiber's CORS middleware refuses to combine that with `*`; see `.env.example`).
- `VITE_API_URL` (web build) → `https://api.yourdomain.com`.
- `COOKIE_SECURE` → `true` (production is always https on both sides).

**If you don't have a domain and want to use the free default hostnames** (`*.pages.dev` + `*.onrender.com`/`*.fly.dev`), say so plainly: **the auth flow will not work as shipped.** The fix is a real code change, out of scope for this task (it touches `apps/api/internal/auth/handler.go`, not a config/doc file):

- Change `SameSite: fiber.CookieSameSiteLaxMode` to `fiber.CookieSameSiteNoneMode` in both `setSessionCookie` and `clearSessionCookie`.
- `SameSite=None` cookies are rejected outright by browsers unless `Secure` is also set — so `COOKIE_SECURE` would need to become non-optional (`true` always in any deployed environment), not just a recommended value.
- This trade loses same-site's other protections and depends on third-party-cookie support in the browser, which several browsers (Safari ITP, and Chrome's ongoing phase-out) are increasingly hostile to for genuinely cross-site cookies — another reason the custom-domain path is the better fix, not just the lower-effort one.
- **Name the protection you are giving up: CSRF.** `SameSite=Lax` is currently this API's *only* CSRF defense — there is no CSRF token, no Origin/Referer check, and no custom-header requirement anywhere in `apps/api`. Switching to `SameSite=None` removes that defense outright: any site the user visits could then issue a credentialed cross-site `POST /sync`, `PUT /ratings/:registryId` or `POST /auth/logout` on their behalf.
- **This is no longer optional advice, and it is no longer only advice.** Debt C-3 called out that this section described the `None` escape hatch without saying it *requires* a replacement defense. It does. **Taking the free-hostname path obliges you to ship an Origin allowlist on state-changing routes, or a double-submit CSRF token, in the same change.** Not afterwards, not as a follow-up ticket. When P1 wrote "the blast radius is a learner's own reading progress rather than money or identity" the platform was single-player; subsystem 4 adds writes that other people read (`PUT /ratings/:registryId`) and subsystem 5 gives the server a GitHub token of its own, so the old size-of-the-damage argument no longer holds and should not be quoted back at this paragraph.

**The gate.** `apps/api/internal/auth/csrf_samesite_test.go` (`TestSessionCookieIsNeverSameSiteNone`) fails the build if any session cookie is set to `SameSite=None` — or if a cookie is written with no `SameSite` at all. Both `setSessionCookie` and `clearSessionCookie` are covered, structurally *and* through the real `Set-Cookie` headers on register / login / logout.

That test is not an obstacle to route around. It is where this decision is recorded, and the order of operations if you genuinely need the cross-site deployment is:

1. Build the replacement defense (Origin allowlist or double-submit token) on every state-changing route.
2. **Replace `TestSessionCookieIsNeverSameSiteNone` with a test that gates the replacement** — i.e. one that fails if a state-changing route accepts a request without a valid Origin/token. Deleting it and putting nothing in its place returns the repo to the state C-3 described, where the string "CSRF" appeared nowhere in `apps/api` and no gate existed at all.
3. Only then flip the attribute, and make `COOKIE_SECURE=true` mandatory rather than recommended.

**Why the default is safe today:** the project owner owns `duy.dev` and the deployment is `tuhoc.duy.dev` + `api.duy.dev`. Those are different origins but the **same site**, so `SameSite=Lax` cookies flow between them and no code change is needed. (Phase 1 planned a third subdomain, `vault.duy.dev`, for the key store; Pha 2 Task 16 deleted the key store, so there are two deployables, not three — and the SameSite argument never depended on how many there were.) C-3 is closed by that decision, not by new code — and the test above is what keeps the decision from being undone by accident.

This runbook's steps assume the custom-domain path. If you go the no-domain route, apply the code change above **before** relying on any authenticated flow, and treat every `CORS_ORIGIN`/`VITE_API_URL` value below as "the `*.pages.dev`/`*.onrender.com` hostname" instead of "the subdomain."

---

## 1. Prerequisites

Install once, locally:

```bash
brew install flyctl              # only if you choose the Fly.io path (§4b)
go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@v4.19.1
```

`bunx wrangler` and Render's dashboard need no local install (Render deploys are git/dashboard-driven; `bunx` fetches `wrangler` on demand). The `migrate` CLI version above is pinned to match `apps/api/go.mod`'s `golang-migrate/migrate/v4 v4.19.1` — this repo's own migration files are exercised programmatically by the same library version inside `store.MigrateUp`/`store.TestPool` (see `apps/api/internal/store/store.go`), so keeping the standalone CLI on the same version avoids any behavioral drift between "what CI/tests ran" and "what actually touched production."

Verified: `go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@v4.19.1` — exit 0. `flyctl` installed via `brew install flyctl` — exit 0 (v0.4.86). `bunx wrangler --version` — exit 0 (4.124.0).

Accounts you'll need (all free to create, no purchases in this runbook):

- **Neon** — neon.tech. No credit card required for the free plan.
- **Cloudflare** — dash.cloudflare.com. No credit card required for Pages.
- **Render** — render.com. Free web services do not require a credit card at signup (verify this still holds when you actually sign up — free-tier terms are the part of this stack most likely to have changed since this doc was written).
- **Fly.io** (only if you pick §4b instead of §4a) — as of writing, Fly.io requires a credit card on file for **every** organization, including new signups on a free trial. This is a real difference from Render, not a formality — it's the main reason this runbook recommends Render first.

---

## 2. Neon: create the database

**[unverified — needs a live account]** — the steps below are precise, but I did not create a Neon account (out of scope: "do not create accounts").

1. Sign up at neon.tech, create a project (e.g. `tuhoc`), default Postgres version is fine.
2. Neon's dashboard shows **two** connection strings for the same database — this distinction matters and is easy to miss:
   - **Pooled** (hostname ends in `-pooler`): `postgres://user:pass@ep-xxxx-pooler.region.aws.neon.tech/tuhoc?sslmode=require`
   - **Direct** (no `-pooler`): `postgres://user:pass@ep-xxxx.region.aws.neon.tech/tuhoc?sslmode=require`
3. **Use the pooled string for `DATABASE_URL`** (the one the running API reads). It goes through Neon's PgBouncer, which is what you want for a normal request-serving app.
4. **Use the direct string for migrations** (§3), never the pooled one. golang-migrate takes a Postgres advisory lock to stop two migration runs from racing each other; advisory locks are session-scoped state, and Neon's pooled endpoint runs PgBouncer in transaction-pooling mode, which cannot hold session state across statements. Running `migrate` against the pooled string either fails outright or (worse) silently skips the locking it's supposed to provide. This is Neon's own documented guidance, not a guess — save both strings somewhere before closing the tab.
5. Free tier facts worth knowing before you rely on this (see §6 for the operational implications): compute autosuspends after **5 minutes** of inactivity and wakes on the next connection in roughly **0.5–2 seconds**; project gets **100 CU-hours/month** and **0.5GB storage** on the free plan.

---

## 3. Apply the schema (migrations)

**Decision:** migrations run as an explicit, operator-driven step using the external `migrate` CLI against the migration files already in this repo (`apps/api/migrations/*.sql`) — **not** wired into the API's boot sequence.

Why not `MIGRATE_ON_BOOT=1` (the other option the task brief named): it would need a real code change to `apps/api/cmd/api/main.go` and `internal/config/config.go` (a new config field, calling `store.MigrateUp` before `app.Listen`, deciding what happens on failure), which is Go application code, not a deploy artifact — out of this task's scope (see "Code Organization" in the task brief: config files + `docs/deploy.md`, not `apps/api` source). An explicit pre-deploy step is also arguably the safer default for this shape of app regardless: it makes "did the new migration actually run" a visible, individually-checkable step instead of something bundled invisibly into every container start, and it can't race itself (this app only ever runs one instance, so that particular risk doesn't apply here, but the explicit step still means a broken migration fails loudly on your terminal instead of crash-looping the production container).

`store.MigrateUp` (`apps/api/internal/store/store.go`) remains the function `TestPool` and any future automation would call — this decision only concerns what runs against the **production** database, not the test path, which is unaffected.

### First deploy: fresh database

```bash
migrate -path apps/api/migrations -database "$NEON_DIRECT_URL" up
```

Run from the repo root, where `$NEON_DIRECT_URL` is the **direct** (non-pooled) connection string from §2. **Verified** against a real Postgres instance (`postgres:16-alpine` in Docker, standing in for Neon — same SQL, same golang-migrate version, same `-path`):

```
$ migrate -path apps/api/migrations -database "postgres://tuhoc:tuhoc@localhost:55432/tuhoc?sslmode=disable" up
1/u init (84.17425ms)
$ echo $?
0
```

`\dt` afterward showed exactly the 7 tables `0001_init.up.sql` defines (`annotations`, `courses`, `events`, `progress`, `schema_migrations`, `sessions`, `users`).

### Subsequent migrations

When a later task adds `apps/api/migrations/0002_*.up.sql` (and a matching `.down.sql`):

1. Merge/deploy the migration files (they ship inside the repo — no separate artifact).
2. Run the same command again, before or as part of rolling out the API build that depends on the new schema:
   ```bash
   migrate -path apps/api/migrations -database "$NEON_DIRECT_URL" up
   ```
3. Re-running `up` with nothing pending is a safe no-op — **verified**: running the command a second time against the same test database printed `no change` and exited 0.

If a migration ever needs reverting: `migrate -path apps/api/migrations -database "$NEON_DIRECT_URL" down 1` rolls back exactly one step (not exercised in this task's verification, but it's the same tool/flags, just `down` instead of `up`).

**If your database already ran `0005_published_catalog` before this branch** (final whole-branch review, M10): that file was amended IN PLACE, not superseded by a new migration number — `admin_audit` gained an explicit `actor` column after some databases had already applied the original version (see `0005_published_catalog.up.sql`'s own comment on why). `golang-migrate` records only `(version, dirty)` in `schema_migrations`; it does not checksum migration files, so a database already at version 5 (or later) will never re-run 0005 no matter how its contents changed — `migrate up` reports `no change` and exits 0, looking exactly like success. The silent gap (a missing `admin_audit.actor` column) does not surface at migration time at all; it surfaces later, as a 500 on the first real publish.

Fix: check where the database actually is, then go back to *before* 0005 and come back up through the current files —

```bash
migrate -path apps/api/migrations -database "$NEON_DIRECT_URL" version
# reports 5, or 6 if this database already ran the newer 0006 on top of
# the stale 0005 content — either way, drop below 0005 (version 4) before
# coming back up:
migrate -path apps/api/migrations -database "$NEON_DIRECT_URL" down <reported-version-minus-4>
migrate -path apps/api/migrations -database "$NEON_DIRECT_URL" up
```

A genuinely fresh database (never migrated before pulling this branch) is unaffected — it reads the current, already-amended `0005_published_catalog.up.sql` the first and only time it ever runs migration 5.

---

## 4. Deploy the API

Pick one. Both configs are provided (`apps/api/fly.toml`, `render.yaml`) because the task asked for both; the recommendation below is Render.

### Recommendation: Render, not Fly.io

Fly.io requires a credit card on file for every organization as of this writing (confirmed directly from Fly's own pricing docs: *"All organizations (except for Linked Organizations) require a credit card on file"*), with a limited free-trial credit rather than a standing free tier. Render's free web service plan does not require a card. Given this task's stated target is genuinely free-tier infrastructure, Render is the better fit; Fly.io is documented as a complete alternative for anyone who already has a Fly account or doesn't mind adding a card.

Both share the same free-tier caveat: **the container sleeps after inactivity and cold-starts on the next request** — covered in §6.

### 4a. Render (recommended)

**[unverified — needs a live account and cannot be exercised without deploying]**, but every value below is real, taken from `render.yaml` and cross-checked against Render's current Blueprint spec. There's no Render CLI config-validate command to run locally without an account; what I did check is that `render.yaml` is syntactically valid YAML and parses into exactly the structure above — `ruby -ryaml -e "YAML.load_file('render.yaml')"` (no extra install needed; macOS's system Ruby ships YAML support) — exit 0.

1. Push this repo to GitHub/GitLab (Render Blueprints deploy from a git remote).
2. Sign up at render.com, connect the repo.
3. Dashboard → **New** → **Blueprint**, pick this repo. Render reads `render.yaml` from the repo root automatically and shows one service, `tuhoc-api` (Docker runtime, `apps/api/Dockerfile`, `apps/api` build context, free plan, Singapore region). `singapore` is one of Render's five documented region values (oregon/ohio/virginia/frankfurt/singapore) — I could not confirm whether the free plan restricts region choice, since that needs a live account; if Render rejects it at Blueprint-creation time, change `region:` in `render.yaml` to `oregon` (Render's original/default region) and redeploy.
4. Before confirming, Render prompts for **every** `sync: false` var declared in `render.yaml`. There are five:
   - `DATABASE_URL` — paste the **pooled** Neon connection string from §2 (not the direct one; that's only for the migration command).
   - `DEEPSEEK_API_KEY` — the platform's own DeepSeek key. **Leaving it blank ships an API whose AI feature is dead**: the service boots clean, `/healthz` is green, and the failure only appears when a learner presses "Hỏi". See §8.
   - `BRAVE_API_KEY` — enables the agent's `web_search` tool only. Blank is a supported state; the agent still answers using its other tools.
   - `GITHUB_TOKEN` — Discussions. Blank is supported (§5c).
   - `ADMIN_TOKEN` — the CLI publish door (§4c). Blank is supported and fails closed.

   The API logs a startup warning naming each missing AI key, so `render logs` immediately after the first deploy tells you whether you filled these in.
5. After the service is created, go to its **Environment** tab and fix the two placeholder values `render.yaml` ships with:
   - `CORS_ORIGIN` → `https://app.yourdomain.com` (or your Pages project's `*.pages.dev` URL if not using a custom domain — see §0)
   - Confirm `COOKIE_SECURE=true` and `PORT=8080` are present (they ship with real values already, not placeholders).
6. Deploy. Render builds the image itself from `apps/api/Dockerfile` on its own infrastructure — this sidesteps the local cross-compile trap entirely (§7 below), since Render's builders target their own runtime architecture directly; you never need to pass `--platform` yourself on this path.
7. Once live, the service URL is `https://tuhoc-api.onrender.com` (or `https://<service-name>.onrender.com` if you renamed it in `render.yaml`) unless you've attached a custom domain. Verify: `curl https://tuhoc-api.onrender.com/healthz` should return `{"ok":true}` (allow up to ~60s for the first request if the service just spun up — see §6).

### 4b. Fly.io (alternative)

**[unverified — needs a live account]**. `flyctl` itself is installed and working locally (`flyctl version` → v0.4.86), but every step past `flyctl auth login` needs a real, carded account.

```bash
cd apps/api
flyctl auth login                     # opens a browser; needs a real account + card on file
flyctl apps create <your-unique-name> # Fly app names are global; edit `app = "tuhoc-api"` in fly.toml to match
flyctl secrets set DATABASE_URL="<pooled Neon connection string from §2>"
flyctl secrets set DEEPSEEK_API_KEY="<the platform's own DeepSeek key>"   # without this the AI feature is dead — see §8
flyctl secrets set BRAVE_API_KEY="<Brave Search key>"                     # optional: enables the web_search tool only
flyctl deploy                         # builds remotely on Fly's own amd64 builders by default — see §7
```

`DEEPSEEK_API_KEY` and `BRAVE_API_KEY` are secrets and must go through `flyctl secrets set`, never `fly.toml`'s `[env]` block — that file is committed to git. `DEEPSEEK_BASE_URL` is deliberately set nowhere: `config.Load` falls back to `DefaultDeepSeekBaseURL`, and pinning a URL in a config file is a second copy of that Go constant. Both keys are optional in the sense that the API boots and serves everything else without them, and it logs a startup warning naming each one that is missing — but an AI-enabled deploy with no `DEEPSEEK_API_KEY` fails only at the moment a learner asks a question.

Then edit `CORS_ORIGIN` in `apps/api/fly.toml`'s `[env]` block from the placeholder to your real Pages origin, and `flyctl deploy` again (or `flyctl secrets set`/`flyctl config` if you'd rather not commit the real value — see §8 on what's secret). Verify with `curl https://<your-app-name>.fly.dev/healthz`.

`flyctl config validate` would be the natural syntax check for `fly.toml`, but it calls Fly's platform API and requires login (`Error: no access token available` when run unauthenticated — confirmed by running it locally). What I verified instead: `apps/api/fly.toml` is syntactically valid TOML — deliberately breaking it (appending a garbage line) changed `flyctl config validate`'s error from the auth message to a TOML parse error at the exact broken line, proving the parser reaches and processes the file before the auth check; with the real file, only the auth error appears.

---

## 4c. First admin: opening the publish door on a fresh deploy

The admin publish API (`PUT`/`DELETE /admin/courses/{slug}` and friends) has **two doors**, and a fresh deploy ships with both shut — correctly, but with nothing in the product itself that opens either one. There is no UI for this and no migration seed; it is entirely an operator step, done once per environment. Skipping this section is why a freshly deployed API can pass every health check and still have no way to publish a single course.

**The two doors, and what each one is for:**

| Door | Credential | Opens | Set where |
|---|---|---|---|
| CLI / scripted publish | `ADMIN_TOKEN` (a shared secret, `Authorization: Bearer <token>`) | Every admin route, with no login session at all — `who = nil`, logged in `admin_audit` as `actor = 'cli'`. What `tuhoc-cli publish` and `scripts/test-e2e.sh`'s seed step use. | Render: Environment tab (`sync: false` in `render.yaml`). Fly: `flyctl secrets set ADMIN_TOKEN=...` — never `fly.toml`'s committed `[env]` block. Local dev: `.env`/shell env. See `.env.example` for the full explanation. |
| Admin login (`/admin` in the web app) | A real user account with `users.role = 'admin'` | The same admin routes, via a normal signed-in session — `who = <that user's id>`, logged as `actor = 'user'`. What a human clicks through in the browser. | The one SQL statement below. |

`adminTokenMatches` (`apps/api/internal/server/server.go`) treats an unconfigured `ADMIN_TOKEN` as "never matches" rather than comparing against an empty string, so an unset token cannot be defeated by an empty `Authorization` header — the CLI door fails closed, not open, when nobody has chosen a value yet. The admin-login door has no equivalent bootstrap at all: `users.role` defaults to `'user'` on every signup (`0005_published_catalog.up.sql`), so even the very first account created on a fresh deploy is an ordinary reader, not an admin. Both doors are closed by design; getting through either one is the step this section fills in.

**To open the CLI door**: set `ADMIN_TOKEN` on the API host — see the table above and `.env.example`'s own comment on that variable (a real secret, e.g. `openssl rand -hex 32`; never the literal fixture value `apps/api/compose.e2e.yml` uses for its own throwaway e2e stack).

**To open the admin-login door** (needed for the `/admin` screen in the browser, independent of whether `ADMIN_TOKEN` is also set):

1. Register a normal account through the web app's own sign-up screen first (`/register`) — this section grants an *existing* account admin, it does not create one.
2. Promote it directly in Postgres, against the same database `DATABASE_URL` points at:
   ```sql
   UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
   ```
   Use the **pooled** connection string for this (any ordinary `psql`/GUI client — this is not a schema change, so it does not need the direct/migrations connection from §2). `role` has a `CHECK (role IN ('user','admin'))` constraint (`0005_published_catalog.up.sql`), so a typo'd value fails loudly rather than silently doing nothing.
3. No re-login needed: `IsAdmin` (`apps/api/internal/auth/usecase.go`) reads `users.role` fresh from the database on every request through `RequireAdmin` — it is not cached in the session cookie — so the very next request from that account's already-open session sees the new role.
4. Verify: sign in as that account and open `/admin` in the web app; `GET /me`'s `role` field should read `"admin"`.

Neither door is a substitute for the other, and either alone is sufficient to publish — a deploy that only ever uses `tuhoc-cli publish` from a trusted machine can skip step 2 entirely and never create an admin-login account at all.

---

## 5. Deploy the web app (Cloudflare Pages)

Pick names before you start if you're following the custom-domain path from §0 — you'll want `CORS_ORIGIN` (API) and `VITE_API_URL` (web) set correctly on **first** deploy rather than chasing a chicken-and-egg update afterward. If you're on default hostnames instead, both Pages (`<project-name>.pages.dev`) and Render (`<service-name>.onrender.com`)/Fly (`<app-name>.fly.dev`) URLs are deterministic from the project/service/app name you pick — so you still don't need to deploy one before naming the other.

### Local build check (done, not a live-account step)

```bash
cd apps/web && bun install && bun run build
```

**Verified**: exit 0. Output:
```
dist/index.html                   2.22 kB
dist/assets/index-*.css         387.84 kB
dist/assets/index-*.js          337.38 kB
```
`dist/` contains `_redirects`, `course-kit/`, `index.html`, `favicon.svg`, `assets/` — confirmed with `ls dist` and `cat dist/_redirects` (see §7 for why the redirects rule's exact contents matter). There is no `dist/courses/`: commit dafd4eb removed the copy that used to create it.

`dist/courses/` is **never created**, whether or not someone ran `make courses`
first; see the note at the top of this file. This changed at commit dafd4eb —
before it, the build copied public sample packages there and task 11 verified
that `bun run build` exits 0 with the source directory both present and absent.
The copy is gone now, so the outcome no longer depends on `courses/` at all.

### 5a. Git integration (recommended for ongoing deploys)

**[unverified — needs a live account]**.

1. dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git → pick this repo.
2. Build settings:
   - Build command: `cd apps/web && bun run build`
   - Build output directory: `apps/web/dist`
   - Root directory: repo root (this is a monorepo; the build command itself `cd`s into `apps/web`)
3. Settings → Environment variables → add `VITE_API_URL` = `https://api.yourdomain.com` (or your API host's default hostname — see §0) for the **Production** environment. This is a Vite *build-time* variable — it has to be visible to the build step, which is why it's set here and not in `apps/web/wrangler.toml` (see that file's own comment for why a `[vars]` block there wouldn't reach it: those are Pages *Functions* runtime bindings, and this app has no Functions).
4. Deploy. Cloudflare runs the build command itself and picks up `apps/web/dist/_redirects` automatically — no extra config needed for the SPA fallback.
5. Verify: load `https://<project>.pages.dev/c/<any-course-id>/<any-chapter-id>` directly (not via in-app navigation) — it should render the reader, not a Cloudflare 404. This exercises the exact case the `_redirects` file exists for.

### 5b. Wrangler CLI (direct upload, e.g. for a one-off deploy without connecting git)

```bash
cd apps/web
VITE_API_URL=https://api.yourdomain.com bun run build
bunx wrangler pages deploy dist --project-name=tuhoc-web
```

**Partially verified.** I ran `bunx wrangler pages deploy` (no directory arg, so it falls back to `wrangler.toml`'s `pages_build_output_dir`) against the real repo without auth, specifically to check config parsing, not to deploy:

```
$ CI=true bunx wrangler pages deploy
✘ [ERROR] In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN environment variable...
```
exit 0 (wrangler's own exit code for this CLI-usage error), reached only *after* successfully reading `pages_build_output_dir` from `apps/web/wrangler.toml` — no config-parse complaint. Confirmed the contrast case too: appending a garbage line to `wrangler.toml` changed the error to `Invalid TOML document: incomplete key-value: cannot find end of key` at the exact broken line, plus wrangler's own fallback warning ("missing pages_build_output_dir... proceeding with project deploy") before failing on the missing directory — proving the valid file really does parse and get used, not silently ignored. The actual deploy (needs `wrangler login` or `CLOUDFLARE_API_TOKEN`) is the unverified part.

No `wrangler pages project validate` or equivalent config-lint command exists in wrangler 4.124.0 (checked `wrangler pages --help`, `wrangler pages project --help` — no such subcommand). The parse-error contrast test above is the closest available substitute.

---

## 5b. The key vault (`apps/vault`) — **RETIRED, there is no third deployable**

**The mechanism this section described no longer exists.** Phase 1 kept each reader's own AI provider
key in their own browser, at a **separate origin** — a second Vite app (`apps/vault`) deployed as its
own Cloudflare Pages project at `vault.<domain>`, embedded in a hidden iframe by the study app, with
`VITE_VAULT_ORIGIN` (web side) and `VITE_APP_ORIGIN` (vault side) pointing at each other and
`frame-ancestors` in `apps/vault/_headers` refusing every other embedder.

Pha 2 Task 16 deleted all of it. The AI agent runs on **our own server** against ONE DeepSeek account
the platform pays for (`DEEPSEEK_API_KEY`, §4), and readers pay in credit — so there is no reader key
left in the browser, nothing to isolate, and no second origin to deploy. **Deploy two things, not
three**: the web app (§5) and the API (§4). Neither `VITE_VAULT_ORIGIN` nor `VITE_APP_ORIGIN` exists
any more; setting either does nothing.

**Carried forward, because the reasoning outlived the subsystem.** The separate origin was not
belt-and-braces: course packages rated `interactive` are **allowed to run JS** (spec §1.2) and that JS
runs on the same page as the app, so a same-origin `/vault/` path would have been worth nothing. It was
proven necessary, not theoretical — S1-F43 was a Critical hole where a `content`-rated package (the
tier *believed* safe) ran arbitrary code through four gates. **Any future feature that puts a
user-held secret back in the browser inherits that finding**, and inherits the conclusion with it: a
path is not a boundary; an origin is.

Also carried forward, so it is not rediscovered as a surprise: `apps/vault/_headers` was **never served
by a real Cloudflare Pages deployment** and `apps/vault` never had a Pages project. The two-way
`frame-ancestors` measurement in the S2 report ran locally. Nothing in this repo has ever proven that
`_headers` file works in production.

## 5c. Catalog registry — **đã nghỉ hưu, không còn `VITE_REGISTRY_URL`**

**Cơ chế mục này từng mô tả không còn tồn tại.** Bản trước của §5c nói nền tảng đọc catalog từ một
tệp `index.json` phục vụ qua GitHub Pages của repo registry, đọc trực tiếp từ trình duyệt bằng
`VITE_REGISTRY_URL` và `apps/web/src/registry/index.ts`'s `PUBLIC_REGISTRY_BASE`. Module đó đã bị
xoá (Task 13) khi pivot server-side dọn sạch: catalog giờ là `GET /courses` — phục vụ bởi chính
`apps/api` từ Postgres (xem §0 và `apps/web/src/api/catalog.ts`) — không còn một `index.json` nào để
trỏ tới, và không trình duyệt nào gọi thẳng ra GitHub Pages nữa. `VITE_REGISTRY_URL` không còn được
đọc ở bất kỳ đâu trong mã; đừng đặt biến này ở host nào cả — final whole-branch review, M6 xoá nó
khỏi `.env.example`/`apps/web/src/vite-env.d.ts` cùng lúc với đoạn này.

`.github/workflows/registry.yml` vẫn còn (xem chú thích đầu tệp đó), nhưng vai trò của nó đã đổi:
một cổng CI tiện lợi kiểm gói trước khi merge PR vào repo nguồn cộng đồng, không còn là nơi xuất bản
catalog nào cả — cổng thật cho việc publish giờ nằm ở server (`PUT /admin/courses/:slug`, §4c).

## 6. Free-tier realities: cold starts, stacked

Both free-tier pieces here sleep independently:

- **Render** (or Fly with `min_machines_running = 0`): the container itself spins down after inactivity (Render: 15 minutes) and takes roughly 30–60 seconds to spin back up on the next request — this happens at the platform level, before your Go process even starts.
- **Neon**: the Postgres compute autosuspends after 5 minutes of inactivity and wakes in roughly 0.5–2 seconds once a new connection arrives.

These two stack on the very first request after a long idle period: the platform spins up a fresh container (30–60s, invisible to the app), which then runs `main()`, which calls `store.Open` with a **hardcoded 10-second timeout** (`apps/api/cmd/api/main.go`'s `dbConnectTimeout`) before it will even start serving HTTP. Two things follow from this:

1. **Normal case**: Neon's own wake time (well under a second, typically) fits comfortably inside that 10s budget, so the container boots fine — the *user-visible* slowness on a cold request is almost entirely the platform-level container spin-up, not the database.
2. **The sharp edge**: because `DATABASE_URL` is always set in production (unlike local dev, where an unset `DATABASE_URL` is a supported no-DB mode — see `main.go`'s own comment on ruling F1), production startup is all-or-nothing: if Neon ever takes longer than 10s to respond (network hiccup, a much longer suspend than usual, etc.), `store.Open` returns an error, `main` calls `log.Fatalf`, and the **entire process exits** — including `/healthz`, which is otherwise designed to work without a database. A slow-waking DB doesn't degrade the API; it takes the whole thing down. In practice this self-heals: Render/Fly both restart a crashed process automatically, and the failed connection attempt itself already told Neon to start waking up, so the retry lands on an already-awake compute and should succeed. If you see `store: database unreachable within 10s` in the logs shortly after a long idle period, that's what's happening — it is not a bug to chase, but it is worth knowing about before you're paged (informally) by it. If this becomes a recurring problem in practice, the actual fix is a code change (raise `dbConnectTimeout`, or make the failure retry with backoff instead of `log.Fatalf`) — out of scope here, flagged for whoever owns `apps/api/cmd/api/main.go` next.

The platform design doc already anticipated the container side of this (`docs/superpowers/specs/2026-08-19-tuhoc-platform-design.md`, §10: *"Free tier ngủ (Render) làm sync chậm | offline-first nên không chặn trải nghiệm; retry backoff"*) — the app's offline-first sync design means a slow/cold first request degrades to "sync catches up later," not a broken experience, for everything except the very first login of a session.

---

## 7. The two debts that live in the build path

Both are already fixed in the repo; this section is what to never undo.

**`_redirects` must not use the force flag.** `apps/web/public/_redirects` reads exactly:
```
/* /index.html 200
```
No `!` on the `200`. A forced rewrite (`200!`) would shadow the real static files this app depends on at runtime — the build ships `course-kit/` (KaTeX and `runtime.js`, classic `<script src>` includes rather than ES modules, so they cannot go through the SPA's JS bundle), and a forced catch-all would intercept every one of those requests and hand back `index.html` instead, breaking every chapter's rendering. `apps/web/index.html` already carries a comment recording this trap; this file is the config that has to actually match it. Verified: `bun run build` → `dist/_redirects` byte-for-byte `/* /index.html 200`, sitting next to `dist/course-kit/`.

Note that `/courses` is now an SPA route (the public catalog) rather than a static directory, and course content is served by `apps/api`, so the unforced `200` is what makes both work: a real file under `course-kit/` wins, and everything else falls through to the SPA. `courseAssets.ts` still serves `courses/*` from disk in **dev and preview** — that is `serveDir`, not the build output — which is why `make dev-web` can still open a package unpacked by `make courses`.

**Production Docker builds need `--platform linux/amd64`.** The Dockerfile's `FROM --platform=$BUILDPLATFORM ... AS build` + `ARG TARGETARCH` pattern cross-compiles: the build stage runs natively on whatever machine is building (fast, no emulation), and `GOARCH=$TARGETARCH` targets whatever `--platform` you asked `docker build` for. Leave `--platform` off entirely and `TARGETARCH` silently defaults to the build host's own architecture. Verified on this (arm64 Apple Silicon) machine:

```
$ docker build -t tuhoc-api:plain apps/api && docker inspect tuhoc-api:plain --format '{{.Architecture}}'
arm64
$ docker build --platform linux/amd64 -t tuhoc-api:amd64 apps/api && docker inspect tuhoc-api:amd64 --format '{{.Architecture}}'
amd64
```
Both builds exited 0 — the failure mode isn't a build error, it's a container that builds fine and then dies with `exec format error` the moment it's started on an amd64 host. This is why:
- Render's Blueprint path is safe by default — Render builds the image on its own infrastructure targeting its own architecture, so `--platform` never needs to be specified by you.
- Fly's default `flyctl deploy` (remote builders) is likewise safe by default.
- The *only* dangerous path is building locally and pushing the result yourself (`docker build` + `docker push`, or `flyctl deploy --local-only`) from an Apple Silicon machine — always pass `--platform linux/amd64` (or whatever architecture your chosen host actually runs) in that case.

---

## 8. Secrets

| Variable | Secret? | Lives where | Notes |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | Render: Environment tab (`sync: false` in `render.yaml`, prompted at Blueprint creation). Fly: `flyctl secrets set DATABASE_URL=...` (never in `fly.toml`'s `[env]`, which is committed). | Use the **pooled** Neon string here — see §2. |
| `ADMIN_TOKEN` | **Yes** | Render: Environment tab (`sync: false` in `render.yaml`). Fly: `flyctl secrets set ADMIN_TOKEN=...` (never in `fly.toml`'s `[env]`). | Opens the CLI-publish door — see §4c for both doors and why unset fails closed rather than open. |
| `DEEPSEEK_API_KEY` | **Yes — and a different risk class from the rows above** | Render: Environment tab (`sync: false`). Fly: `flyctl secrets set DEEPSEEK_API_KEY=...` (never in `fly.toml`'s `[env]`). | The platform's own credential to DeepSeek — see the note right after this table for what makes this different from `ADMIN_TOKEN`/`GITHUB_TOKEN`, and the revocation path if it leaks. Unset is a valid state: the AI feature degrades to "not configured" rather than the API refusing to boot. |
| `DEEPSEEK_BASE_URL` | No | `render.yaml` / `fly.toml` `[env]`, or leave unset | Defaults to `https://api.deepseek.com` (`config.DefaultDeepSeekBaseURL`) — normal deploys never need to set this at all. Only exists for pointing at a proxy or a test double. |
| `BRAVE_API_KEY` | **Yes — same risk class as `DEEPSEEK_API_KEY`** | Render: Environment tab (`sync: false`). Fly: `flyctl secrets set BRAVE_API_KEY=...` (never in `fly.toml`'s `[env]`). | The platform's own credential to the Brave Search API (the agent's web-search tool — spec §3.2). Unset just switches that one tool off. See the note below the table. |
| `CORS_ORIGIN` | No, but environment-specific | `render.yaml` `[env]` / `fly.toml` `[env]` — both ship with an obvious `REPLACE-WITH-PAGES-ORIGIN` placeholder | Not a credential, but must be your *exact* production origin, not the placeholder, or CORS silently rejects the web app. |
| `PORT` | No | `render.yaml` / `fly.toml` `[env]` | Fixed at `8080`, matches the Dockerfile's `EXPOSE`. |
| `COOKIE_SECURE` | No | `render.yaml` / `fly.toml` `[env]` | Ships as `"true"` already — production is always https on both sides. |
| `VITE_API_URL` | No, but must not be committed with a real backend URL if you consider that sensitive routing info | Cloudflare Pages dashboard (Environment variables) for git-integration builds, or exported in the shell for CLI builds | Baked into the public JS bundle at build time either way — it's visible to anyone who opens devtools, so "secret" isn't really the right frame for it; it's environment-specific, not confidential. |
| Neon DB password (inside `DATABASE_URL`) | **Yes** | Same as `DATABASE_URL` above | Never appears in any file in this repo. |

**`DEEPSEEK_API_KEY` and `BRAVE_API_KEY` are not just two more rows in this table.** Every other secret above either belongs to nobody in particular (`DATABASE_URL`) or is the platform's OWN credential to something that costs nothing if it leaks (`ADMIN_TOKEN` only opens a door on this same app; `GITHUB_TOKEN`, where configured, is read-only against public data). These two are the platform's own credential to a **billed third-party account**, and this is the exact risk the server-side pivot introduces (`docs/superpowers/specs/2026-08-25-server-side-pivot.md` §0.1): a leaked key here does not cost one reader their own key, it spends money on the platform's bill until somebody notices and revokes it. Three rules follow directly from that:

1. **Set only through the environment** — never committed, never in a log, never hand-typed into a support ticket. `apps/api/internal/server/provider_key_never_leaks_test.go` enforces the code side of this (the key must never reach a log line or a response body); this doc covers the operational side.
2. **Rotate by revoking, not by adding.** Minting a second key and leaving the first one active means the leaked key keeps working until someone explicitly kills it — generating a new one is not the same step as disabling the old one, and skipping the second step is how a "rotation" leaves the actual hole open.
3. **If a key leaks:** revoke it immediately in the provider's own dashboard (DeepSeek: platform.deepseek.com; Brave: api-dashboard.search.brave.com/register — under whichever account holds the platform's subscription) — do this *before* generating the replacement, since the leaked key keeps spending until it's revoked, not until a new one exists. Generate a new key, set it via the host's secret UI (table above), and restart the process (`flyctl deploy` / a Render manual deploy — an env var change alone does not restart a running container). Then check the provider's own usage/billing dashboard for the window the key may have been exposed: unlike a leaked reader key in the Pha 1 architecture, there is no individual "affected user" to notify — the entire cost of misuse lands on the platform's one bill.

What must never be committed: any real `DATABASE_URL` (pooled or direct), any real Neon password, any real `DEEPSEEK_API_KEY`/`BRAVE_API_KEY`, and — once you've filled it in for your own deploy — your production `CORS_ORIGIN`/`VITE_API_URL` are not secret but there's no reason to commit your personal domain into a shared repo either; keep the checked-in `fly.toml`/`render.yaml` on the `REPLACE-WITH-...` placeholders and set the real values through each host's own env-var UI. The root `.gitignore` already covers `.env`; `.env.example` (this task's deliverable) intentionally contains no real values, only placeholders and documentation.

---

## 9. Redeploying

- **API code change, no new migration**: push to the connected branch (Render) or `flyctl deploy` (Fly). Both rebuild the image from `apps/api/Dockerfile` on their own infrastructure — no local `--platform` concern (§7).
- **API code change with a new migration**: run §3's `migrate ... up` against `$NEON_DIRECT_URL` first (or immediately after — this schema's migrations are additive-only so far; a genuinely breaking migration would need its own ordering judgment call, not covered here), then deploy the new API build.
- **Web change**: push to the connected branch (git-integration Pages) or re-run `bun run build && bunx wrangler pages deploy dist --project-name=...` (CLI path). Nothing about `_redirects` or `courses/`/`course-kit/` needs touching per-deploy — `courseAssets.ts`'s `closeBundle` hook copies them into `dist/` on every `bun run build` automatically.
- **Changed `CORS_ORIGIN` or `VITE_API_URL`** (e.g. attaching a custom domain after the fact): update the API host's env var and redeploy the API; update Cloudflare Pages' env var and **rebuild** the web app (it's baked in at build time, so just changing the dashboard value without a new build does nothing — see §5's `VITE_API_URL` note).

---

## Appendix: the `tools/` pytest dependency (not a deploy step, but a carried debt closed in this task)

`make test-extract` depends on `pytest`, which isn't part of this repo's own install graph — nothing before this task pinned it or documented how to get it. Fixed:

- `tools/requirements.txt` pins `pytest==9.1.1` (the version already in use; `iniconfig`/`packaging`/`pluggy`/`pygments` are pulled in transitively by pip from that one line).
- `make setup-extract` (new target, root `Makefile`) runs `python3 -m pip install --break-system-packages -r tools/requirements.txt`. `--break-system-packages` is required on Homebrew Python (PEP 668 "externally managed environment" — a plain `pip install` refuses to touch the system Python's site-packages without it); this matches what the original ad-hoc install on this machine needed, and installs into the user site-packages (`~/Library/Python/3.14/lib/python/site-packages`), not the Homebrew-managed one, which is exactly what that flag is for.
- Verified: `make setup-extract` → exit 0 (`Requirement already satisfied` for the pinned version — this machine already had it via the same ad-hoc path). `make test-extract` → exit 0, 5 passed.
