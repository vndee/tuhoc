import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Connect, Plugin, ResolvedConfig } from 'vite';

// apps/web/vite-plugins/ -> repo root is two levels up.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

const COURSE_KIT_DIR = path.join(REPO_ROOT, 'packages/course-kit');
const COURSES_DIR = path.join(REPO_ROOT, 'courses');
const FIXTURES_COURSES_DIR = path.join(REPO_ROOT, 'fixtures/courses');

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
 * The ids of the course packages this repo itself publishes — read from
 * `fixtures/courses/<dir>/manifest.json`, which is committed source.
 *
 * This is the ONLY allowlist in the build. Everything else that turns up in
 * the `courses/` working directory came from somewhere outside the git tree
 * (`TUHOC_COURSE_STORE`, see scripts/course_workspace.py) and is therefore
 * somebody's private package by construction — not by a name we guessed.
 *
 * Deliberately fail-closed: a missing, empty or unparseable `fixtures/courses`
 * yields the EMPTY set, which means nothing at all is copied into `dist/`. An
 * empty `dist/courses/` is a documented, correct state for this platform
 * (docs/deploy.md: "`courses/*` is normally EMPTY, and a deploy is expected to
 * ship it empty"), so failing closed costs a fresh clone nothing, while
 * failing open would cost the author their textbook.
 */
export function readPublicCourseIds(fixturesDir: string = FIXTURES_COURSES_DIR): Set<string> {
  const ids = new Set<string>();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(fixturesDir, { withFileTypes: true });
  } catch {
    return ids;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const raw = fs.readFileSync(path.join(fixturesDir, entry.name, 'manifest.json'), 'utf8');
      const id: unknown = (JSON.parse(raw) as { id?: unknown }).id;
      if (typeof id === 'string' && id.length > 0) ids.add(id);
    } catch {
      // A fixture directory without a readable manifest is not a public
      // course id. Silence is right here: `fixtures/` is source, and a broken
      // one is caught by the test suites that read it, not by this copy step.
    }
  }
  return ids;
}

export type CourseVerdict = {
  /** Directory name under `courses/`. */
  dir: string;
  /** True only when the package is one this repo itself publishes. */
  isPublic: boolean;
  /** Why, in one clause — printed for every skipped package. */
  reason: string;
};

/**
 * Decide, for every entry in the `courses/` working directory, whether it is
 * one of this repo's own public sample packages or somebody's private one.
 *
 * Two conditions, and BOTH must hold — the directory name and the package's
 * own `manifest.id` must each be a known public id. `scripts/course_workspace.py`
 * unpacks into `courses/<manifest id>/`, so the two normally agree; when they
 * do not, something hand-made is sitting there and the honest answer is "I do
 * not know what this is", which for this decision means "do not ship it".
 */
export function classifyCourseDirs(
  coursesDir: string,
  publicIds: ReadonlySet<string>,
): CourseVerdict[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(coursesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const verdicts: CourseVerdict[] = [];
  for (const entry of entries) {
    if (entry.name === '.gitkeep') continue;
    if (!entry.isDirectory()) {
      verdicts.push({ dir: entry.name, isPublic: false, reason: 'not a directory' });
      continue;
    }
    if (!publicIds.has(entry.name)) {
      verdicts.push({
        dir: entry.name,
        isPublic: false,
        reason: 'no package of this id in fixtures/courses/ — it came from the private store',
      });
      continue;
    }
    let manifestId: unknown;
    try {
      const raw = fs.readFileSync(path.join(coursesDir, entry.name, 'manifest.json'), 'utf8');
      manifestId = (JSON.parse(raw) as { id?: unknown }).id;
    } catch {
      verdicts.push({ dir: entry.name, isPublic: false, reason: 'no readable manifest.json' });
      continue;
    }
    if (manifestId !== entry.name) {
      verdicts.push({
        dir: entry.name,
        isPublic: false,
        reason: `manifest.id is ${JSON.stringify(manifestId)}, which is not the directory name`,
      });
      continue;
    }
    verdicts.push({ dir: entry.name, isPublic: true, reason: 'published by this repo' });
  }
  return verdicts;
}

/**
 * Everything sitting directly under `dist/courses/` that is not a public
 * course id. Empty array means the bundle is clean.
 *
 * Strict on purpose: a *file* there, or a directory named anything else, is
 * equally "something the build did not put there on purpose".
 */
export function findUnpublishableInDist(
  distCoursesDir: string,
  publicIds: ReadonlySet<string>,
): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(distCoursesDir);
  } catch {
    return [];
  }
  return names.filter((name) => !publicIds.has(name)).sort();
}

/**
 * Copy the `courses/` working directory into the bundle, ONE PACKAGE AT A
 * TIME, and only the ones this repo publishes.
 *
 * This replaces a whole-directory copy, and the replacement is the entire
 * point of S1's C2b finding: the old copy put whatever happened to be on the
 * author's disk into `apps/web/dist/`, which is the directory
 * `wrangler pages deploy dist` uploads to a public, unauthenticated host. The
 * measurement that produced this change found 46 files / 1.20 MB of the
 * author's private textbook already sitting there, guarded by nothing but a
 * paragraph of prose in docs/deploy.md.
 *
 * It is a FILTER rather than a check-and-fail because the author's ordinary
 * dev loop has a private package in `courses/` (four Makefile targets run
 * `make courses` first). A build that went red in that state would need an
 * escape hatch, and an escape hatch used daily is always on. Excluding
 * instead of refusing keeps `bun run build` green in exactly the state the
 * author works in, and makes the leak structurally impossible rather than
 * merely detected.
 *
 * Skipping is loud — one line per package — because a silent exclusion is how
 * you end up debugging a missing chapter for an hour.
 *
 * A missing `courses/` is a normal state, not a build failure: since task 11
 * no course lives in this repo, so a fresh clone has an empty `courses/` — or
 * none at all, if someone deleted the directory that only holds a `.gitkeep`
 * — and `bun run build` has to work in exactly that state. (The asymmetry
 * with `packages/course-kit` is deliberate: that one is committed source,
 * every chapter renders through its `runtime.js`, and a build that quietly
 * shipped without it would produce a site of blank formulas. Missing there
 * stays loud, which is why it still goes through plain `copyDir`.)
 */
function copyPublicCoursesOnly(src: string, dest: string, publicIds: ReadonlySet<string>) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const verdict of classifyCourseDirs(src, publicIds)) {
    if (verdict.isPublic) {
      fs.cpSync(path.join(src, verdict.dir), path.join(dest, verdict.dir), {
        recursive: true,
        dereference: true,
      });
      continue;
    }
    console.warn(
      `course-assets: courses/${verdict.dir} KHÔNG vào dist/ — ${verdict.reason}.\n` +
        '  Đây là hành vi đúng: bundle production chỉ mang gói mẫu công khai của repo này.\n' +
        '  Gói riêng vẫn phục vụ bình thường ở `vite dev` và `vite preview`. Xem docs/publishing.md §2.7.',
    );
  }
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

      // The publish gate. Two steps, and they answer two different questions.
      const publicIds = readPublicCourseIds();
      const distCourses = path.join(outDir, 'courses');

      // 1. Filter: only this repo's own public packages get copied at all.
      copyPublicCoursesOnly(COURSES_DIR, distCourses, publicIds);

      // 2. Assert: and then look at what is actually on disk.
      //
      // Step 1 alone already makes the leak impossible, so this second step
      // never fires on a correct build — which is exactly why it is here. It
      // is a regression guard on step 1, aimed at the specific way this bug
      // came back before: someone simplifies the per-package copy back into a
      // whole-directory `copyDir(COURSES_DIR, ...)` because it reads cleaner,
      // and nothing anywhere goes red. Now something does, on the very next
      // `bun run build`, and it names the package it caught.
      //
      // It is also the only check that sees `dist/` rather than intent, so it
      // catches a package that arrived by a path this plugin knows nothing
      // about — a hand copy, a half-finished build from another branch, a
      // stray `cp -r`.
      const unpublishable = findUnpublishableInDist(distCourses, publicIds);
      if (unpublishable.length > 0) {
        // Dọn TRƯỚC khi ném. Ném rồi mới dọn — hay ném mà không dọn — để lại
        // `dist/` đúng trạng thái vừa bị bắt: một bản build đỏ mà thư mục
        // deploy vẫn nạp sẵn đạn. `wrangler pages deploy dist` không hỏi lần
        // build gần nhất xanh hay đỏ; nó chỉ đọc thư mục. Phép đo tìm ra điều
        // này là thật, không phải giả định: lần chạy đối chứng đầu tiên của
        // chốt này để lại 46 tệp giáo trình riêng trong `dist/courses/` sau
        // khi build đã thoát 1.
        for (const name of unpublishable) {
          fs.rmSync(path.join(distCourses, name), { recursive: true, force: true });
        }
        throw new Error(
          'course-assets: dist/courses/ mang thứ KHÔNG được publish: ' +
            unpublishable.join(', ') +
            '\n  Gói công khai của repo này (fixtures/courses/): ' +
            (publicIds.size > 0 ? [...publicIds].sort().join(', ') : '(không có)') +
            '\n  `wrangler pages deploy dist` sẽ đẩy thư mục này lên một host CÔNG KHAI,' +
            ' KHÔNG auth.' +
            '\n  Chúng đã bị XOÁ khỏi ' +
            distCourses +
            ' — nhưng build vẫn đỏ, vì thứ đưa được chúng tới đó một lần thì' +
            ' đưa được lần nữa. Tìm ra chỗ đó trước. Xem docs/publishing.md §2.7.',
        );
      }
    },
  };
}
