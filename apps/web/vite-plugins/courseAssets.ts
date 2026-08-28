import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Connect, Plugin, ResolvedConfig } from 'vite';

// apps/web/vite-plugins/ -> repo root is two levels up.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

const COURSE_KIT_DIR = path.join(REPO_ROOT, 'packages/course-kit');
const COURSES_DIR = path.join(REPO_ROOT, 'courses');

const MIME_BY_EXT: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/**
 * Serves one URL prefix ("/course-kit" or "/courses") from a directory on
 * disk, for the Vite dev server. These directories hold classic scripts
 * (runtime.js, vendor/*.js, viz.js) that attach globals — they must NOT go
 * through Vite's module graph, so they are served as plain static files and
 * loaded at runtime via `<script src="...">`, not `import`.
 */
function serveDir(urlPrefix: string, rootDir: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = req.url ?? '';
    if (!url.startsWith(urlPrefix)) return next();

    const withoutPrefix = url.slice(urlPrefix.length).split(/[?#]/, 1)[0];
    const relPath = decodeURIComponent(withoutPrefix || '/');
    const filePath = path.normalize(path.join(rootDir, relPath));

    // Path-traversal guard: resolved path must stay inside rootDir.
    if (filePath !== rootDir && !filePath.startsWith(rootDir + path.sep)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) return next();
      const ext = path.extname(filePath).toLowerCase();
      res.setHeader('Content-Type', MIME_BY_EXT[ext] ?? 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      fs.createReadStream(filePath)
        .on('error', () => {
          res.statusCode = 500;
          res.end('Internal Server Error');
        })
        .pipe(res);
    });
  };
}

function copyDir(src: string, dest: string) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, dereference: true });
}

/**
 * Makes packages/course-kit/* reachable at /course-kit/... and courses/*
 * reachable at /courses/... in `vite dev` and `vite preview` — DEV/PREVIEW
 * ONLY as of the final whole-branch review's Important 5; `vite build`'s
 * output no longer carries a `courses/` copy at all. See `closeBundle`'s own
 * comment for why.
 *
 * Chosen approach for the dev/preview half: a small custom middleware
 * rather than Vite's `publicDir`, so the same `serveDir` + path-traversal
 * guard covers `/course-kit` too — `packages/course-kit` sits outside
 * `apps/web/`, which `publicDir` cannot reach without a symlink.
 *
 * Since task 11, `courses/` is empty in a fresh clone: no course lives in
 * this repo any more (this phase's server-side pivot went further still —
 * the platform's readers get a course from Postgres via `apps/api`, not
 * from a file under this directory at all), and what appears there locally
 * is a package `make courses` unpacked for the handful of unit/dev/e2e
 * paths that still read one directly off disk (see `closeBundle`). `serveDir`
 * is fine with an empty or missing `courses/` regardless — a missing file
 * falls through to `next()`, which is a 404.
 */
export function courseAssets(): Plugin {
  let resolvedConfig: ResolvedConfig;

  return {
    name: 'course-assets',
    apply: () => true,
    configResolved(config) {
      resolvedConfig = config;
    },
    configureServer(server) {
      server.middlewares.use(serveDir('/course-kit', COURSE_KIT_DIR));
      server.middlewares.use(serveDir('/courses', COURSES_DIR));
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveDir('/course-kit', COURSE_KIT_DIR));
      server.middlewares.use(serveDir('/courses', COURSES_DIR));
    },
    closeBundle() {
      // Skip during `vite build --ssr` intermediate passes etc. — only run
      // for the real client build.
      if (!resolvedConfig || resolvedConfig.command !== 'build') return;
      const outDir = path.isAbsolute(resolvedConfig.build.outDir)
        ? resolvedConfig.build.outDir
        : path.join(resolvedConfig.root, resolvedConfig.build.outDir);

      // course-kit only. Final whole-branch review, Important 5: this used
      // to also copy `courses/` into `dist/courses/` (filtered to this
      // repo's own public sample packages — S1-C2b's fix for a 46-file /
      // 1.20 MB private-textbook leak), which `wrangler pages deploy dist`
      // then uploaded to the session origin. That copy is GONE, not
      // narrowed further: the server-side pivot
      // (docs/superpowers/specs/2026-08-25-server-side-pivot.md) means
      // course content is served from Postgres via apps/api now, never
      // from static files next to the SPA bundle, so shipping ANY course
      // content here — public or private, v1 free-running `viz.js` or
      // otherwise — is a second, unsynced source of truth for exactly the
      // format this phase's central security decision retired. course-kit
      // stays: KaTeX and the reader runtime (`runtime.js`,
      // `vendor/*.js`) are still classic `<script src>` includes every
      // chapter's rendering depends on, loaded from THIS path in
      // production regardless of where the chapter HTML itself came from.
      copyDir(COURSE_KIT_DIR, path.join(outDir, 'course-kit'));
    },
  };
}
