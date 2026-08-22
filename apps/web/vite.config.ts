import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { courseAssets } from './vite-plugins/courseAssets.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), courseAssets()],
  resolve: {
    alias: {
      // CSS-only alias: reader.css + vendor/katex.css are imported through
      // this and bundled/hashed by Vite normally. The classic-script assets
      // next to them (runtime.js, vendor/*.js) are NOT imported through this
      // alias — they are served as plain files by the courseAssets plugin
      // and loaded via <script src> at runtime (Task 11), because they
      // attach globals and would break if run through Vite's module
      // pipeline.
      '@course-kit': path.resolve(HERE, '../../packages/course-kit'),
      // The course-package RULE SET, shared with the packaging CLI and
      // registry CI — see packages/course-format/src/index.ts's own header,
      // which names this alias as the way a consumer reaches it (the repo
      // has no npm workspaces and no root package.json, so there is nothing
      // for `bun install` to link).
      //
      // Aliased to `src/index.ts` and not to the directory: the package's
      // `main` field points there, but Vite's alias is a plain path rewrite
      // and does not read package.json, so a directory alias would resolve
      // to `.../course-format/index.ts`, which does not exist.
      //
      // Its own two dependencies (`parse5`, `fflate`) resolve out of
      // `packages/course-format/node_modules`, because Node/Vite resolution
      // walks up from the IMPORTING file, not from this app. That directory
      // has to exist — `cd packages/course-format && bun install` — which is
      // what the Makefile's test-format target already says.
      '@tuhoc/course-format': path.resolve(HERE, '../../packages/course-format/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    // 30s, not vitest's 5s default. This is a HARNESS budget, not an
    // assertion: nothing here waits on a bare timer. Every wait inside a
    // test is a `waitFor`/`findBy*` with its own bound (1000ms by
    // default), so a genuinely stuck test still fails on ITS OWN clock —
    // raising this cannot mask a hang, it can only stop the harness from
    // killing a test that is doing real, slow work.
    //
    // Why it was needed: under `--maxWorkers=24` on 8 cores, Vite
    // transforming a cold module graph *inside* a timed test body was
    // measured at 8,984ms (445ms idle). That produced red runs with NO
    // failing assertion — the most misleading signal a suite can give,
    // and it cost this phase three separate investigations before the
    // cause was found. See `syncLifecycle.test.tsx`'s beforeAll for the
    // complementary fix: warm the imports so the work leaves the body.
    testTimeout: 30_000,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // `apps/web/e2e/p1.spec.ts` (Task 17) is a Playwright spec, run only
    // via `bunx playwright test` (see playwright.config.ts's own
    // `testDir: './e2e'`) — never by vitest. Without this exclude,
    // vitest's own default include glob (`**/*.{test,spec}.*`) would
    // match it too (its filename ends in `.spec.ts`, same as every other
    // spec/test file in this repo) and `bun run test` would try to run
    // Playwright's `test`/`expect` against jsdom, an incompatible API
    // surface. `node_modules`/`dist` are listed explicitly alongside
    // `e2e` rather than left to vitest's own default `exclude` —
    // specifying this option replaces that default rather than
    // extending it.
    exclude: ['**/node_modules/**', '**/dist/**', './e2e/**'],
  },
});
