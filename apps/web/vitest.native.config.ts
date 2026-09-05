import { defineConfig } from 'vitest/config';

// Required, explicit real-codec gate; ordinary Vitest runs stay portable.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/export-story-plates.native.test.ts'],
    testTimeout: 30_000,
  },
});
