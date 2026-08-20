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
    },
  },
  test: {
    environment: 'jsdom',
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
