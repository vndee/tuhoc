# Tuhoc Platform

A multi-course self-study platform designed to aggregate, organize, and deliver interactive learning content. This monorepo contains the core infrastructure, course management kit, and the web and API applications that power the platform.

## Available Commands

| Command | Description |
|---------|-------------|
| `make dev-api` | Start the API development server (Go/Fiber) |
| `make dev-web` | Start the web development server (Bun) |
| `make test-api` | Run API tests |
| `make test-web` | Run web tests |
| `make test-format` | Run course-format rule set tests (vitest + `tsc -b`) |
| `make test-cli` | Run packaging CLI tests (vitest + `tsc -b`) |
| `make pack DIR=my-course` | Validate a course directory and write its `.zip` |
| `make courses` | Unpack the course packages held outside this repo into `courses/` |
| `make test-extract` | Run content extraction tests |
| `make extract` | Extract course content from source material |

## Authoring a course

A course is a detachable package: a directory with a `manifest.json`, its
chapters, and nothing that has to live in this repo. `tools/tuhoc-cli` is the
front door for it — `bun tools/tuhoc-cli/src/index.ts init my-course` scaffolds
a valid skeleton, and `make pack DIR=my-course` checks it against the shared
rule set in `packages/course-format` and writes the zip, printing every problem
at once (with the file and the fix) instead of failing one rebuild at a time.
Format reference: `docs/course-format.md`.

## No course ships with this repo

`courses/` is empty in a fresh clone, and that is the intended shape: the
platform does not come with content, content arrives as a package a reader
imports from a `.zip` on the `/import` screen. What appears under `courses/`
locally is a package someone unpacked with `make courses` from a store outside
the git tree (`TUHOC_COURSE_STORE`, default `~/Documents/claude/tuhoc-courses`);
the directory is `.gitignore`d in full.

One consequence to expect rather than debug: four unit test files and the four
e2e files read a **real** chapter, on purpose, and go red without a package to
read — with a message naming the command to run. They are not switched to
hand-written fixtures, because in this repo hand-written prose fixtures have
passed while the real chapter failed. `docs/publishing.md` has the whole story,
including what has to happen to git history before this repo is made public.

## Documentation

See the [platform design specification](docs/superpowers/specs/2026-08-19-tuhoc-platform-design.md) for full architecture and feature details.
