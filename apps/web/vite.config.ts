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
  },
});
