# Security policy

## Reporting a vulnerability

**Email <tuhoc@duy.dev>. Please do not open a public issue for a security
problem.**

This is a small community project maintained in spare time. There is no bug
bounty and no paid triage — what you get in return is a straight answer:

- an acknowledgement within **7 days**;
- an assessment (accepted / not a vulnerability / already known) within **30 days**;
- credit in the fix commit, if you want it.

If you have not heard back in 7 days, assume the mail went astray and send it
again rather than assuming it was ignored.

## What is in scope

The two deployables in this repository: `apps/api` (Go) and `apps/web` (React).
The kind of thing worth reporting:

- authentication or session handling that can be bypassed;
- one user reaching another user's progress, notes, or annotations;
- the admin surface (`PUT /admin/courses/:slug`) reachable without
  `TUHOC_ADMIN_TOKEN`;
- injection through a course package — a `.zip` that escapes the
  `packages/course-format` rule set and executes script in a reader's browser;
- secrets leaking into responses, logs, or the built bundle.

## What is out of scope

- **Course content being wrong.** Most of it is AI-generated and may contain
  errors. That is a documented property of the project, not a vulnerability —
  see the README. Open a normal issue.
- Findings from automated scanners with no demonstrated impact.
- Anything requiring a compromised host, a malicious maintainer, or physical
  access to a reader's machine.
- Denial of service through sheer volume against the public instance.

## Please do not

Test against the public instance in a way that touches other people's data,
degrades service, or creates content other readers can see. If you need a
target, run the stack locally — `make dev-api` and `make dev-web` bring up the
whole thing, and `make test-e2e` brings up a real Postgres in Docker.
