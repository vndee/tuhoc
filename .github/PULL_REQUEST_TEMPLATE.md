## What this changes, and why

<!-- The diff already says what. Say why. If you changed an approach, say what
     the previous one got wrong. -->

## How it was verified

<!-- Which gates you ran, and their result. Be honest about what you did NOT
     run — "did not run make test-e2e, no Docker locally" is a useful sentence
     and will not be held against you. -->

- [ ] `make test-api`
- [ ] `make test-web`
- [ ] `make test-format`
- [ ] `make test-cli`
- [ ] `make test-registry`
- [ ] `make test-e2e`

## Checklist

- [ ] I staged explicit paths, not `git add -A`
- [ ] This is one logical change; anything unrelated I found is in a separate issue
- [ ] No course content was added to `courses/` (it belongs in a package — see CONTRIBUTING.md)
- [ ] Any new gate goes **red** when it cannot reach what it measures, rather than quietly passing

## Related issues

<!-- Closes #123 -->
