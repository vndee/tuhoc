# Contributing

Thank you for looking. This is a community, non-commercial project; everything
here is MIT-licensed and contributions are welcome.

Vietnamese and English are both fine — in issues, pull requests, and code
comments. Much of this codebase is commented in Vietnamese.

## Before you write code

**Open an issue first for anything larger than a bug fix.** Not bureaucracy —
this repository carries a lot of recorded reasoning (`docs/`), and a change that
looks obviously right often contradicts a decision someone measured. A short
issue saves you the rewrite.

For a bug, the most useful thing you can send is the input and the wrong output.

## Getting set up

You need **Go 1.22+**, **[Bun](https://bun.sh)**, **Python 3.10+**, and
**Docker** (only for `make test-e2e`).

```bash
make deps      # bun install everywhere that has its own package.json
make courses   # unpack the sample course packages into courses/
make dev-api   # API on :8080
make dev-web   # web on :5173
```

`make courses` on a fresh clone prints a line saying it skipped a private
package store and unpacks the two sample packages this repo commits. That is
the correct, expected output — see "Courses do not live here" below.

## Running the gates

Run the ones your change touches; run all of them before opening a PR.

| Command | Covers |
|---|---|
| `make test-api` | `apps/api` — Go, plus `gofmt` |
| `make test-web` | `apps/web` — `tsc -b` and vitest |
| `make test-format` | `packages/course-format` — the shared course rule set |
| `make test-cli` | `tools/tuhoc-cli` — the packaging CLI |
| `make test-registry` | `tools/registry` — the PR validator CI runs |
| `make test-e2e` | Real Postgres + API in Docker + Playwright. Read `docs/testing.md` first. |

**`make check-publish` is not one of these.** It is a pre-publish privacy gate
for the maintainer, and it needs a marker list that deliberately lives outside
this repository. On your clone it will report *"KHÔNG đo được gì"* and exit 1.
That is the gate failing closed on purpose, not a bug and not your fault —
ignore it.

## Tests: a house rule worth knowing

Several test files read a **real** chapter from `courses/` rather than a
hand-written fixture, and go red with a message naming the command to run if
it is missing. This is deliberate and documented: in this repository,
hand-written prose fixtures have passed while a real chapter failed. Please do
not "fix" such a test by replacing the real data with an inline string.

More generally: **a gate that cannot reach what it measures must go red, not
quiet.** If you add a check, make its blind spots loud. There are several
recorded cases here of a green tick that measured nothing.

## Commits and pull requests

- **Stage explicit paths — never `git add -A`.** Several agents and worktrees
  operate in this repository concurrently, and `-A` sweeps up other people's
  work-in-progress. This has happened; it is not hypothetical.
- Write a commit message that says **why**, not what. The diff already says
  what. If you changed an approach, say what the previous one got wrong.
- One logical change per PR. If you find an unrelated bug on the way, say so in
  the PR and open a separate issue.
- Keep the PR description honest about what you did and did not verify. "Tests
  pass locally, did not run e2e" is a useful sentence.

## Courses do not live here

A course is a **detachable package** — a directory with a `manifest.json` and
its chapters — not a directory in this repository. `courses/` is a local
working directory and is `.gitignore`d in full; a PR that adds course content
to it will be asked to change shape.

To author one:

```bash
bun tools/tuhoc-cli/src/index.ts init my-course
make pack DIR=my-course
```

`pack` checks the package against `packages/course-format` and prints every
problem at once, with the file and the fix. The server re-runs that identical
rule set on publish, so a package that passes locally is not a second opinion
the server might overrule. Format reference: `docs/course-format.md`.

The AI-risk curriculum lives in its own repository:
**[vndee/tuhoc-courses](https://github.com/vndee/tuhoc-courses)**. Content
issues — a wrong proof, a bad citation — belong there, not here.

## Security

Do not open a public issue for a security problem. See [SECURITY.md](SECURITY.md).

## Licence

By contributing you agree that your contribution is licensed under the
[MIT Licence](LICENSE), the same terms as the rest of this repository.
