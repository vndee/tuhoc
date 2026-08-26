# Tuhoc Platform

A multi-course self-study platform designed to aggregate, organize, and deliver interactive learning content. This monorepo contains the core infrastructure, course management kit, and the web and API applications that power the platform.

## Available Commands

| Command | Description |
|---------|-------------|
| `make dev-api` | Start the API development server (Go/Fiber) |
| `make dev-web` | Start the web development server (Bun) |
| `make deps` | `bun install` in every directory that has its own `package.json` |
| `make test-api` | Run API tests (Go) |
| `make test-web` | Run web tests (`tsc -b` + vitest) |
| `make test-format` | Run course-format rule set tests (vitest + `tsc -b`) — the shared TS rule set `pack` and the browser import both use |
| `make test-cli` | Run packaging CLI tests (vitest + `tsc -b`) |
| `make test-registry` | Run registry-tooling tests, plus `validate-pr.ts` against `fixtures/registry` |
| `make test-e2e` | Bring up a real Postgres + API in Docker, build the production web bundle, and run the Playwright e2e suite against all of it |
| `make pack DIR=my-course` | Validate a course directory and write its `.zip` |
| `make check-publish` | Refuse to proceed if any private course content is still reachable from the repo — the pre-publish gate |
| `make courses` | Unpack the course packages held outside this repo into `courses/`, for local dev/test fixtures |
| `make test-extract` | Run content extraction tests |
| `make extract` | Extract course content from source material |

## Authoring a course

A course is a detachable package: a directory with a `manifest.json`, its
chapters, and nothing that has to live in this repo. `tools/tuhoc-cli` is the
front door for it:

```
bun tools/tuhoc-cli/src/index.ts init my-course
make pack DIR=my-course
bun tools/tuhoc-cli/src/index.ts publish my-course.zip --server https://tuhoc.example.com
```

`init` scaffolds a valid skeleton. `pack` (or `make pack DIR=my-course`) checks
it against the shared rule set in `packages/course-format` and writes the zip,
printing every problem at once (with the file and the fix) instead of failing
one rebuild at a time — the identical rule set the server re-runs, so a package
that passes `pack` locally is not a second opinion the server might overrule.
`publish` sends that zip to `PUT /admin/courses/<slug>`, authenticated by
`TUHOC_ADMIN_TOKEN` (read from the environment, never a command-line argument);
the server re-validates from scratch and only stores the package if it comes
back clean. Format reference: `docs/course-format.md`.

## No course ships with this repo

`courses/` is empty in a fresh clone, and that is the intended shape — but not
because content is missing from the platform: courses live on the **server**
now (Postgres, behind the public catalog `GET /courses`), reachable by anyone
with no account and no import step, not on disk in this repository. What
`courses/` holds locally is dev/test fixture data: `make courses` unpacks the
sample packages this repo commits (`fixtures/courses/`) plus, if you have one,
a private store outside the git tree (`TUHOC_COURSE_STORE`, default
`~/Documents/claude/tuhoc-courses`) — the directory is `.gitignore`d in full,
and nothing under it is what a reader actually sees in production.

An author's road onto the platform is `tuhoc publish` (above), not a file
landing in this repo. One consequence to expect rather than debug: several
unit test files and e2e files read a **real** chapter, on purpose, and go red
without the fixture packages `make courses`/`make test-e2e`'s own seed step
puts in place — with a message naming the command to run. They are not
switched to hand-written fixtures, because in this repo hand-written prose
fixtures have passed while a real chapter failed. `docs/publishing.md` has the
fuller story.

## Documentation

See the [platform design specification](docs/superpowers/specs/2026-08-19-tuhoc-platform-design.md) for full architecture and feature details.
