# tuhoc

A self-study platform for long-form, interactive courses — the software behind
**[tuhoc.duy.dev](https://tuhoc.duy.dev)**.

A course here is not a video playlist. It is a package of chapters with real
mathematics (KaTeX), interactive widgets, exercises, and per-reader progress,
notes, and annotations. This monorepo is the platform: the API, the web reader,
the course-format rule set, and the CLI that packages a course.

> **This is a community, non-commercial project, and most of the course content
> is AI-generated.** It is written to be checked, not trusted: verify anything
> you intend to rely on. Corrections are welcome — see
> [Contributing](#contributing).

## What is where

| Path | What it is |
|---|---|
| `apps/api` | Go / Fiber API over Postgres — catalog, auth, progress, notes, annotations, AI endpoints |
| `apps/web` | React + Vite reader, bilingual (Vietnamese / English) |
| `packages/course-format` | The course rule set, in TypeScript. The **single** definition — `pack` and the server both run it |
| `packages/course-kit` | The runtime a chapter loads in the reader: styles, widget host |
| `tools/tuhoc-cli` | `init`, `pack`, `publish` — the author's front door |
| `tools/registry` | The PR validator CI runs against submitted courses |
| `fixtures/` | Two sample course packages plus shared test data |
| `docs/` | Architecture, testing, course format, and the recorded reasoning behind them |

## Quick start

You need **Go 1.22+**, **[Bun](https://bun.sh)**, and **Python 3.10+**.
Docker is needed only for `make test-e2e`.

```bash
make deps      # bun install in every directory that has its own package.json
make courses   # unpack the sample course packages into courses/
make dev-api   # API on :8080
make dev-web   # reader on :5173
```

`make courses` prints a line saying it skipped a private package store. That is
correct on a fresh clone — see [No course ships with this repo](#no-course-ships-with-this-repo).

## Commands

| Command | Description |
|---------|-------------|
| `make dev-api` / `make dev-web` | Development servers |
| `make deps` | `bun install` in every directory with its own `package.json` |
| `make test-api` | `apps/api` — Go tests, plus `gofmt` |
| `make test-web` | `apps/web` — `tsc -b` and vitest |
| `make test-format` | The shared course rule set that `pack` and the browser both use |
| `make test-cli` | The packaging CLI |
| `make test-registry` | Registry tooling, plus `validate-pr.ts` against `fixtures/registry` |
| `make test-e2e` | Real Postgres + API in Docker (with a fake DeepSeek double — no run ever calls the real provider), the production bundle, and Playwright against all of it. See [`docs/testing.md`](docs/testing.md) |
| `make pack DIR=my-course` | Validate a course directory and write its `.zip` |
| `make courses` | Unpack course packages into `courses/` for local dev and test data |

`cd apps/web && bun run test:story-plates-native` runs the real-codec artwork
gate; prerequisites are in [`docs/testing.md`](docs/testing.md).

`make check-publish` is a maintainer-only privacy gate, and it needs a marker
list that deliberately lives outside this repository. On your clone it exits 1
saying it could not measure anything. That is fail-closed working as intended —
ignore it.

## Authoring a course

A course is a **detachable package**: a directory with a `manifest.json`, its
chapters, and nothing that has to live in this repo.

```bash
bun tools/tuhoc-cli/src/index.ts init my-course
make pack DIR=my-course
bun tools/tuhoc-cli/src/index.ts publish my-course.zip --server https://tuhoc.example.com
```

`pack` checks the package against `packages/course-format` and prints every
problem at once — with the file and the fix — instead of failing one rebuild at
a time. The server re-runs that identical rule set on publish, so a package that
passes locally is not a second opinion the server might overrule. `publish`
sends the zip to `PUT /admin/courses/<slug>`, authenticated by
`TUHOC_ADMIN_TOKEN` read from the environment, never from a command-line
argument. Format reference: [`docs/course-format.md`](docs/course-format.md).

## No course ships with this repo

`courses/` is empty in a fresh clone, and that is the intended shape — not
because content is missing, but because courses live on the **server** (Postgres,
behind the public catalog `GET /courses`), reachable by anyone with no account
and no import step.

What `courses/` holds locally is dev and test data: `make courses` unpacks the
two sample packages this repo commits (`fixtures/courses/`) plus, if you have
one, a package store outside the git tree (`TUHOC_COURSE_STORE`, default
`../tuhoc-courses` beside this repo). The directory is `.gitignore`d in full.

One consequence to expect rather than debug: several unit and e2e tests read a
**real** chapter on purpose, and go red — with a message naming the command to
run — if the packages are missing. They are not switched to hand-written
fixtures, because in this repository hand-written prose fixtures have passed
while a real chapter failed.

**The AI-risk curriculum lives in its own repository:
[vndee/tuhoc-courses](https://github.com/vndee/tuhoc-courses).** Content issues
— a wrong proof, a bad citation — belong there, not here.

## Special editions

`/stories` carries long-form bilingual essays with interactive labs: issue 01,
*A History of Artificial Intelligence*, and issue 02, *Across the Noise*, twelve
labs each. Issue 02's [design and model contracts](docs/superpowers/specs/2026-09-05-across-the-noise-design.md)
and [verification report](docs/superpowers/reports/2026-09-05-across-the-noise-review.md)
record its limits and release checks.

## Documentation

- [`docs/testing.md`](docs/testing.md) — browser suites and artwork gates
- [`docs/course-format.md`](docs/course-format.md) — the package format
- [`docs/publishing.md`](docs/publishing.md) — how private content is kept out of a public repo, and the five leak paths a naïve `git filter-repo` misses
- [`PRODUCT.md`](PRODUCT.md) and [`DESIGN.md`](DESIGN.md) — product and design context
- [`docs/superpowers/specs/2026-08-25-server-side-pivot.md`](docs/superpowers/specs/2026-08-25-server-side-pivot.md) — **the current architecture.** Courses, progress, notes, annotations, and AI all live on the server; the browser keeps no local-first store
- `docs/carried-forward.md` — debts and rulings still in effect

[`docs/superpowers/specs/2026-08-19-tuhoc-platform-design.md`](docs/superpowers/specs/2026-08-19-tuhoc-platform-design.md)
is the original local-first design (Dexie/IndexedDB, a cursor-based `/sync`). It
is a **dated record, deliberately not rewritten**, and is superseded by the pivot
above. Read it for history, not for how the platform works today.

## Contributing

Issues and pull requests are welcome, in Vietnamese or English. Please read
[CONTRIBUTING.md](CONTRIBUTING.md) first — particularly the note on staging
explicit paths, and the house rule that a gate which cannot reach what it
measures must go red rather than quiet.

- [Code of conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md) — do not open a public issue for a vulnerability

## Licence

[MIT](LICENSE) © 2026 Duy Huynh.

Course content is licensed separately: the AI-risk curriculum in
[vndee/tuhoc-courses](https://github.com/vndee/tuhoc-courses) is
**CC BY-SA 4.0**.
