/**
 * Reading the course registry: one file, one request, and one shape check at
 * the boundary.
 *
 * The registry is a **third-party data source** — a static `index.json` served
 * from GitHub Pages by a repository this app does not control, built by
 * `tools/registry/src/build-index.ts` at some commit that is not necessarily
 * this one. Everything in this file follows from that single fact.
 *
 * ## The regression this exists to make impossible
 *
 * Commit `815a472`: `api.get<T>` handed back a chunk of **HTML typed as `T`**
 * (an SPA host answered an unknown path with `200 text/html`). A non-empty
 * string is truthy, so every `?.` downstream failed to short-circuit,
 * `.courses` was `undefined`, `.map` threw during render, and with no error
 * boundary the whole React tree unmounted:
 * `document.body.innerHTML === '<div id="root"></div>'`. A white screen, not
 * one word on it. **Every unit gate stayed green the entire time.**
 *
 * GitHub Pages produces exactly that body for a path it does not have. So the
 * same shape, from a source we cannot fix by fixing our own server.
 *
 * ## Checked HERE, at the boundary — not at the call sites
 *
 * `api/stats.ts`'s `assertStats` wrote down why, from experience: guarding
 * call sites fixes the sites you thought of. The first pass through that bug
 * guarded `stats.courses` in `course/owned.ts`, and *the very next test*
 * found `stats.days` in `Dashboard.tsx:171` still unguarded. One check at the
 * boundary covers every present and future consumer, and it converts a render
 * crash into the error state callers already handle.
 *
 * This file copies that pattern deliberately, and extends it one level: the
 * check descends **into each entry**, because `Catalog.tsx` reads
 * `entry.versions.length`, and an entry missing `versions` throws during
 * render — which is the same white screen with a longer path to it.
 *
 * ## Not `api.get`
 *
 * `api/client.ts` sends `credentials: 'include'` and prefixes `VITE_API_URL`,
 * because it talks to *our* server. Reusing it here would send the learner's
 * session cookie to a machine we do not own. This module uses `fetch`
 * directly with `credentials: 'omit'` stated explicitly, and there is a test
 * asserting that.
 *
 * ## There is deliberately NO cache written by this module
 *
 * The plan asked for an `ETag` cache. It was built, then removed, because two
 * measurements taken 2026-08-22 said it could not work on the target it was
 * for, and keeping it cost something real:
 *
 *   1. **JavaScript cannot read the ETag.** `curl -D -` against a live GitHub
 *      Pages host returns `etag: "689c7eee-386e"` and
 *      `access-control-allow-origin: *` — and **no `Access-Control-Expose-
 *      Headers`**. Per Fetch, that leaves only the safelisted response
 *      headers readable from a page, and `ETag` is not one of them. So
 *      `res.headers.get('etag')` is `null` in a browser, nothing would ever
 *      be stored, and no conditional request would ever be sent. Worse, if
 *      one HAD been stored, `If-None-Match` is not a safelisted *request*
 *      header either, so sending it triggers an `OPTIONS` preflight that
 *      Pages does not answer — a catalog that works on a device's first load
 *      and fails on every load after it.
 *   2. **The browser already does this, correctly, for free.** The same
 *      response carries `cache-control: max-age=600`. HTTP caching is the
 *      browser's own machinery: it revalidates with its own `If-None-Match`,
 *      which is not subject to preflight because the page never set it. A
 *      JS-level cache duplicates that badly and cannot beat it.
 *
 * And the cost: a `localStorage` cache is a THIRD persistent store, which
 * `db/local.test.ts` ("no third place for user data to hide") refuses by
 * design — every key must first be classified in `db/local.ts` as user
 * content or device preference so `clearLocalData()` can be right about it.
 * A cache of public third-party data is neither, so keeping it meant widening
 * a deliberately narrow, security-adjacent invariant to hold something that
 * measurably did nothing. That gate found this within one run of
 * `make test-web`, which is the gate working exactly as intended.
 *
 * What remains is a real two-layer cache, just not one this file writes:
 * `useRegistry.ts`'s `staleTime` within a session, and the browser's HTTP
 * cache across sessions, driven by the registry's own headers. That is what
 * the plan's own architecture line — *"phục vụ qua GitHub Pages — cache
 * CDN"* — actually refers to.
 */

import type { RegistryEntry, RegistryIndex } from './types.ts';

/* ------------------------------------------------------------------ *
 * Format version
 * ------------------------------------------------------------------ */

/**
 * The `index.json` format version this build of the platform can read.
 *
 * Must equal `INDEX_SCHEMA` in `tools/registry/src/build-index.ts`. It is
 * restated rather than imported because that module is Node-only — see
 * `./types.ts` — and `./schemaContract.test.ts` holds the two numbers
 * together.
 *
 * An index whose `schema` is anything else is REFUSED, not partially read.
 * That is the whole point of the field: an older platform meeting a newer
 * index must break loudly rather than guess.
 */
export const SUPPORTED_INDEX_SCHEMA = 1;

/* ------------------------------------------------------------------ *
 * Where the registry lives
 * ------------------------------------------------------------------ */

/**
 * The public registry, used when nothing is configured.
 *
 * **`null` today, and that is a measurement rather than an omission.** The
 * standalone public registry repository does not exist yet: the Task 1+2
 * report records that `.github/workflows/registry.yml` currently runs inside
 * *this* repo against `fixtures/courses`, and that where the standalone repo
 * gets the rule set was left as an open decision (plan HC-2b). There is no
 * URL to put here that would be true.
 *
 * Writing a plausible-looking one anyway is the option this project has a
 * ruling against. A fabricated host fails as a bare `TypeError` from `fetch`,
 * indistinguishable from being offline (ruling S1-F25), so a self-hoster
 * would be told their network was broken. `null` produces
 * `RegistryNotConfiguredError`, which names the variable to set — true, and
 * actionable.
 *
 * **When the registry repo exists, this is a one-line change**, and the
 * mechanism behind it is already proven: `resolveRegistryBase`'s middle
 * branch — env unset, fallback set — is what a self-hosted build with no
 * configuration takes, and it has its own test. Spec §1.1's "a self-hosted
 * install can use the public registry read-only" is that branch.
 */
export const PUBLIC_REGISTRY_BASE: string | null = null;

/** Nothing told this build where the registry is. */
export class RegistryNotConfiguredError extends Error {
  constructor() {
    super(
      'Chưa có địa chỉ registry. Đặt biến môi trường VITE_REGISTRY_URL (địa chỉ gốc của registry, ' +
        'ví dụ https://<tổ-chức>.github.io/<repo>) lúc build, hoặc dùng registry công khai khi nó sẵn sàng.',
    );
    this.name = 'RegistryNotConfiguredError';
  }
}

/**
 * Which registry this build reads, in priority order.
 *
 * Pure, and takes both inputs as arguments, so all three branches are
 * measurable from a test — including the middle one, which is the whole of
 * the self-hosted promise and would otherwise only be reachable by rebuilding
 * the app with a different constant.
 *
 * The base is an ORIGIN + PATH, not the index URL itself: the publish job
 * lays out `index.json` beside a `courses/` tree (see the workflow's "gom cây
 * course vào _site" step), so Task 6 fetches packages from `${base}/courses/…`
 * off the same one configured value.
 */
export function resolveRegistryBase(fromEnv: string | undefined, fallback: string | null): string {
  const chosen = fromEnv !== undefined && fromEnv !== '' ? fromEnv : fallback;
  if (chosen === null || chosen === '') throw new RegistryNotConfiguredError();
  return chosen.replace(/\/+$/, '');
}

/** The registry this build reads. Throws `RegistryNotConfiguredError` if nothing is set. */
export function configuredRegistryBase(): string {
  return resolveRegistryBase(import.meta.env.VITE_REGISTRY_URL, PUBLIC_REGISTRY_BASE);
}

/** The one file the platform fetches to browse the catalog. */
export function indexUrl(base: string): string {
  return `${base}/index.json`;
}

/* ------------------------------------------------------------------ *
 * Errors — one class per way this can go wrong, because the sentence a
 * reader needs is different for each
 * ------------------------------------------------------------------ */

/**
 * A response arrived and its body is not a JSON object.
 *
 * Named, not folded into "malformed", because the cause and the fix are
 * different: this is a TRANSPORT-shaped fault (wrong URL, a 404 page served
 * with a 200, a proxy interposing a login page), and telling the operator
 * "the catalog is missing a field" would send them to read the registry's
 * data when the problem is which bytes came back.
 */
export class RegistryNotJsonError extends Error {
  // Khai tường minh: `erasableSyntaxOnly` cấm tham số-thuộc tính (TS1294).
  readonly url: string;
  readonly status: number;
  readonly contentType: string | null;
  readonly bodyStart: string;

  constructor(url: string, status: number, contentType: string | null, bodyStart: string) {
    super(
      `Địa chỉ ${url} trả ${status} nhưng thân phản hồi không phải JSON` +
        (contentType === null ? '' : ` (content-type: ${contentType})`) +
        '.',
    );
    this.name = 'RegistryNotJsonError';
    this.url = url;
    this.status = status;
    this.contentType = contentType;
    this.bodyStart = bodyStart;
  }
}

/** A non-2xx answer from the registry host. */
export class RegistryHttpError extends Error {
  readonly url: string;
  readonly status: number;

  constructor(url: string, status: number) {
    super(`Registry trả mã ${status} cho ${url}.`);
    this.name = 'RegistryHttpError';
    this.url = url;
    this.status = status;
  }
}

/**
 * The body is JSON of the right general kind but does not carry what this app
 * reads. Mirrors `MalformedStatsError` in `api/stats.ts` field for field,
 * including carrying the list rather than only a sentence.
 */
export class MalformedRegistryIndexError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(`Danh mục registry thiếu hoặc sai kiểu ở: ${missing.join(', ')}`);
    this.name = 'MalformedRegistryIndexError';
    this.missing = missing;
  }
}

/**
 * The index declares a format version this build does not know.
 *
 * Deliberately NOT a subclass of `MalformedRegistryIndexError`: the registry
 * is fine and this platform is old. Reporting it as "the catalog is broken"
 * would point at the wrong side, and the reader's action ("update", or wait
 * for the operator to deploy) is different from every other case here.
 */
export class UnsupportedRegistrySchemaError extends Error {
  readonly found: number;
  readonly supported: number;

  constructor(found: number, supported: number) {
    super(`Danh mục registry dùng định dạng phiên bản ${found}; bản tuhoc này chỉ đọc được phiên bản ${supported}.`);
    this.name = 'UnsupportedRegistrySchemaError';
    this.found = found;
    this.supported = supported;
  }
}

/** True for the errors that mean "the bytes are the problem", where retrying changes nothing. */
export function isRegistryDataError(error: unknown): boolean {
  return (
    error instanceof RegistryNotJsonError ||
    error instanceof MalformedRegistryIndexError ||
    error instanceof UnsupportedRegistrySchemaError ||
    error instanceof RegistryNotConfiguredError
  );
}

/**
 * One human sentence per failure, for the surfaces that show it to a learner
 * — the same job `describeAuthError` (`api/client.ts`) and
 * `describeCourseError` (`course/loader.ts`) already do.
 *
 * They are deliberately distinguishable from each other AND from
 * `shell/ErrorBoundary`'s generic "Màn hình này gặp lỗi": the boundary is the
 * last net, and a screen that only ever produced the net's wording would have
 * told the reader nothing about which of five quite different things went
 * wrong. `Catalog.test.tsx` asserts the boundary's wording is absent in every
 * failure case, and `index.test.ts` asserts these five are pairwise distinct.
 */
export function describeRegistryError(error: unknown): string {
  if (error instanceof RegistryNotConfiguredError) return error.message;

  if (error instanceof UnsupportedRegistrySchemaError) {
    return (
      `Danh mục registry dùng định dạng phiên bản ${error.found}, còn bản tuhoc bạn đang chạy chỉ đọc được ` +
      `phiên bản ${error.supported}. Nền tảng cần được cập nhật. Danh mục KHÔNG được đọc thử — đọc một định dạng ` +
      'lạ theo phỏng đoán là cách sai lặng lẽ nhất.'
    );
  }

  if (error instanceof RegistryNotJsonError) {
    return (
      'Địa chỉ registry trả về một trang web chứ không phải danh mục: thân phản hồi của index.json không phải JSON' +
      (error.contentType === null ? '' : ` (content-type: ${error.contentType})`) +
      '. Thường là do địa chỉ registry sai, hoặc máy chủ trả trang 404 của chính nó thay cho tệp.'
    );
  }

  if (error instanceof MalformedRegistryIndexError) {
    return (
      `Danh mục registry đọc được nhưng thiếu hoặc sai kiểu ở: ${error.missing.join(', ')}. ` +
      'Đây là lỗi ở phía registry, không phải ở máy bạn.'
    );
  }

  if (error instanceof RegistryHttpError) {
    return `Registry trả mã ${error.status} cho index.json. Địa chỉ registry có thể sai, hoặc registry đang gặp sự cố.`;
  }

  // No response ever arrived. Ruling S1-F25: a CORS refusal in production is
  // byte-for-byte the same bare `TypeError` as being offline, and the browser
  // genuinely does not tell the page which. Naming one cause as fact is how
  // an entire misconfigured deploy told every visitor their wifi was bad.
  return 'Không tải được danh mục registry. Có thể bạn đang ngoại tuyến, hoặc registry đang bị cấu hình sai (CORS/DNS).';
}

/* ------------------------------------------------------------------ *
 * The boundary check
 * ------------------------------------------------------------------ */

/** Coarse runtime type of one catalog entry — the fields this app reads. */
function entryProblems(value: unknown, at: string): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [`${at} (không phải object)`];
  }
  const o = value as Partial<Record<keyof RegistryEntry, unknown>>;
  const bad: string[] = [];
  for (const field of ['id', 'title', 'lang', 'tier', 'latest'] as const) {
    if (typeof o[field] !== 'string') bad.push(`${at}.${field}`);
  }
  // `description` is shown but an absent one is cosmetic, so it is checked for
  // TYPE and not for presence — `Catalog` renders it only when non-empty.
  // `versions` is not in that category: `Catalog` reads `.length` on it.
  if (o.description !== undefined && typeof o.description !== 'string') bad.push(`${at}.description`);
  if (!Array.isArray(o.versions)) bad.push(`${at}.versions`);
  return bad;
}

/**
 * Shape check, not schema validation: the fields this app reads, and their
 * coarse runtime types. Anything deeper belongs to whoever adds a field that
 * needs it.
 *
 * ## Order matters, and it is a decision
 *
 * `schema` is checked BEFORE the rest. An index written in a future format
 * will almost certainly look "missing fields" to an older reader, and
 * reporting that as "the catalog is broken" blames the registry for the
 * platform's age and sends whoever reads the message in the wrong direction.
 * A missing `schema` altogether is the opposite case — that is not a registry
 * index at all — and stays "malformed".
 *
 * ## One bad entry rejects the whole index, on purpose
 *
 * The alternative, dropping bad entries and rendering the rest, makes a
 * course silently invisible with no message anywhere — the exact shape of the
 * five blind gates recorded in `docs/carried-forward.md`. And it cannot
 * happen through the normal path: `build-index.ts` re-runs the rule set and
 * refuses to emit an index containing an invalid package, so a malformed
 * entry means producer and consumer have drifted, which is worth stopping
 * for. The message names the index of the offending entry so the registry
 * operator can find it.
 */
export function assertRegistryIndex(body: unknown): RegistryIndex {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    const start = typeof body === 'string' ? body.slice(0, 120) : String(body).slice(0, 120);
    throw new RegistryNotJsonError('index.json', 200, null, start);
  }

  const o = body as Partial<Record<keyof RegistryIndex, unknown>>;

  if (typeof o.schema !== 'number') throw new MalformedRegistryIndexError(['schema']);
  if (o.schema !== SUPPORTED_INDEX_SCHEMA) {
    throw new UnsupportedRegistrySchemaError(o.schema, SUPPORTED_INDEX_SCHEMA);
  }

  const missing: string[] = [];
  if (typeof o.generatedAt !== 'string') missing.push('generatedAt');
  if (!Array.isArray(o.courses)) missing.push('courses');
  else {
    o.courses.forEach((entry, i) => missing.push(...entryProblems(entry, `courses[${i}]`)));
  }

  if (missing.length > 0) throw new MalformedRegistryIndexError(missing);
  return body as RegistryIndex;
}

/* ------------------------------------------------------------------ *
 * The fetch
 * ------------------------------------------------------------------ */

export interface FetchIndexOptions {
  /** Which registry to read. Defaults to `configuredRegistryBase()`. */
  base?: string;
  signal?: AbortSignal;
}

/**
 * Fetches and validates `index.json`. **One request, one file.**
 *
 * No GitHub API call is made for browsing — that is a stated constraint of
 * the subsystem, and the reason the registry publishes a single flat file to
 * Pages: CDN-cached, and no per-IP rate limit the way the API has.
 *
 * Nothing about caching appears below, on purpose; see this module's header
 * for the two measurements behind that. The request also sets no headers of
 * its own, which is what keeps it a **simple CORS request** — no preflight,
 * so it works against a plain static host that answers `GET` and nothing
 * else. GitHub Pages is exactly that host.
 */
export async function fetchRegistryIndex(options: FetchIndexOptions = {}): Promise<RegistryIndex> {
  const base = options.base ?? configuredRegistryBase();
  const url = indexUrl(base);

  const res = await fetch(url, {
    // Third-party origin: never send this app's session cookie there.
    credentials: 'omit',
    signal: options.signal,
  });

  if (!res.ok) throw new RegistryHttpError(url, res.status);

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // The `815a472` shape, from a source we do not own. Named here rather
    // than left to `assertRegistryIndex` so the message can carry the URL,
    // the status and the content-type — the three things that identify which
    // host answered and with what.
    throw new RegistryNotJsonError(url, res.status, res.headers.get('content-type'), text.slice(0, 120));
  }
  return assertRegistryIndex(parsed);
}
