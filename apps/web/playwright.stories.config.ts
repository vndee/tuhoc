import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testDir: './e2e/across-the-noise',
  testIgnore: [],
  testMatch: 'across-the-noise*.spec.ts',
  use: { ...base.use, baseURL: 'http://localhost:5184', channel: 'chrome' },
  webServer: {
    ...base.webServer,
    command: 'bun run build && bun run preview -- --port 5184 --strictPort',
    url: 'http://localhost:5184',
    reuseExistingServer: false,
    env: { VITE_API_URL: process.env.VITE_API_URL ?? `http://localhost:${process.env.TUHOC_E2E_API_PORT ?? 8089}` },
    timeout: 300_000,
  },
});
