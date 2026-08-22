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
 * `copyDir`, but a source directory that is not there is a normal state rather
 * than a build failure.
 *
 * That is only true of ONE of the two directories this plugin copies, and the
 * asymmetry is the point:
 *
 *   - `packages/course-kit` is source. It is committed, `runtime.js` and the
 *     KaTeX vendor bundle are what every chapter renders through, and a build
 *     that quietly shipped without it would produce a site whose every page is
 *     blank formulas. Missing there must stay loud, so it does NOT come
 *     through here.
 *   - `courses/` is a **working directory**, not source (see `.gitignore`).
 *     Since task 11 no course lives in this repo; a course is a detachable
 *     package the reader imports from a `.zip`. A fresh clone therefore has an
 *     empty `courses/` — or none at all, if someone deleted the directory that
 *     only holds a `.gitkeep` — and `bun run build` has to work in exactly
 *     that state. `fs.cpSync` throws ENOENT on a missing source, which would
 *     turn the ordinary case into a red build.
 *
 * An empty directory already worked before this; what is new is tolerating the
 * directory being absent.
 */
function copyDirIfPresent(src: string, dest: string) {
  if (!fs.existsSync(src)) {
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    return;
  }
  copyDir(src, dest);
}

/**
 * Makes packages/course-kit/* reachable at /course-kit/... and courses/*
 * reachable at /courses/... in BOTH `vite dev` and `vite build` output.
 *
 * Chosen approach: a small custom middleware (dev) + a post-build copy
 * (build), rather than a `publicDir` + symlink arrangement. Reasoning:
 *   - `publicDir` copying in `vite build` uses Node's directory copy, and
 *     symlink-follow behavior there is not something we want to depend on
 *     silently working — a dev-only fix that quietly breaks the production
 *     bundle is the most likely failure mode here (see task brief).
 *   - A hand-rolled middleware + `fs.cpSync(..., { dereference: true })`
 *     gives explicit, verifiable control in both modes with zero extra
 *     dependencies, and both are covered by an explicit fetch-and-check step
 *     (see task report) rather than assumed to work.
 *
 * Since task 11, `courses/` is empty in a fresh clone: no course lives in this
 * repo any more, and what appears there locally is a package someone unpacked
 * with `make courses`. Both halves have to be fine with that — `serveDir`
 * already was (a missing file falls through to `next()`, which is a 404, the
 * right answer for a course nobody imported), and the build half is now too;
 * see `copyDirIfPresent`.
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
      copyDir(COURSE_KIT_DIR, path.join(outDir, 'course-kit'));
      copyDirIfPresent(COURSES_DIR, path.join(outDir, 'courses'));
    },
  };
}
