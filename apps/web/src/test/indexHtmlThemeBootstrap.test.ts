/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML_PATH = resolve(HERE, '../../index.html');

/**
 * useTheme() alone cannot prevent a flash of the wrong theme: it applies
 * `data-theme` from a `useEffect`, which only runs after the browser's
 * first paint. jsdom's `render()` also flushes effects inside `act()`
 * before any assertion runs, so that flash is structurally invisible to
 * theme.test.tsx — no amount of testing the React tree can catch it.
 *
 * The actual fix is a synchronous inline `<script>` in index.html's
 * `<head>`, before the module script, mirroring what the original
 * single-file app did. What we CAN assert from a test is the mechanism:
 * that script exists, reads the right storage key, and runs before
 * `main.tsx` loads (source order == execution order for a non-deferred,
 * non-module classic script followed by a module script).
 */
describe('index.html theme bootstrap', () => {
  const html = readFileSync(INDEX_HTML_PATH, 'utf-8');

  it('has a synchronous (non-module) inline script that reads the itbook-theme key', () => {
    const scriptTags = [...html.matchAll(/<script(\b[^>]*)>([\s\S]*?)<\/script>/gi)];
    const bootstrap = scriptTags.find(
      ([, attrs, body]) => !/type\s*=\s*["']module["']/i.test(attrs) && body.includes('itbook-theme'),
    );

    expect(bootstrap).toBeDefined();
    const [, attrs, body] = bootstrap!;
    expect(attrs).not.toMatch(/type\s*=\s*["']module["']/i);
    expect(attrs).not.toMatch(/\bsrc\s*=/i); // inline, not an external/deferred file
    expect(body).toMatch(/localStorage\.getItem\(\s*['"]itbook-theme['"]\s*\)/);
    expect(body).toMatch(/document\.documentElement\.dataset\.theme\s*=/);
    expect(body).toMatch(/\btry\b/);
    expect(body).toMatch(/\bcatch\b/);
  });

  it('runs before the React module script, so it applies before hydration', () => {
    const bootstrapIndex = html.indexOf('itbook-theme');
    const moduleScriptIndex = html.search(/<script[^>]*type\s*=\s*["']module["'][^>]*>/i);

    expect(bootstrapIndex).toBeGreaterThan(-1);
    expect(moduleScriptIndex).toBeGreaterThan(-1);
    expect(bootstrapIndex).toBeLessThan(moduleScriptIndex);
  });
});
