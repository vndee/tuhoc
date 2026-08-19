import type { Manifest } from './types';

const REQUIRED_RUNTIME_MAJOR = 1;

/**
 * Thrown when an HTTP fetch for a course asset (manifest or chapter) does
 * not return a 2xx status. Distinct from `ManifestParseError` so callers
 * can tell "the file isn't there" apart from "the file is there but junk".
 */
export class CourseFetchError extends Error {
  readonly url: string;
  readonly status: number;

  constructor(url: string, status: number) {
    super(`Failed to fetch course asset: HTTP ${status} at ${url}`);
    this.name = 'CourseFetchError';
    this.url = url;
    this.status = status;
  }
}

/**
 * Thrown when a manifest response is not usable as a `Manifest` — either
 * the body isn't valid JSON (a misconfigured static host will happily
 * return an HTML error page with a 200 status) or it parsed fine but is
 * missing fields a manifest requires.
 */
export class ManifestParseError extends Error {
  readonly url: string;

  constructor(url: string, cause: unknown) {
    super(`Manifest at ${url} is not a usable manifest`);
    this.name = 'ManifestParseError';
    this.url = url;
    this.cause = cause;
  }
}

/** Thrown when a manifest's `runtime` field's major version isn't the one this app supports. */
export class RuntimeMismatchError extends Error {
  readonly required: string;
  readonly got: string;

  constructor(got: string) {
    super(`This app supports course runtime ^${REQUIRED_RUNTIME_MAJOR}, but the manifest declares "${got}"`);
    this.name = 'RuntimeMismatchError';
    this.required = `^${REQUIRED_RUNTIME_MAJOR}`;
    this.got = got;
  }
}

function assetUrl(courseId: string, relPath: string): string {
  // Absolute URL, not a bare "/courses/..." string: relative URLs aren't
  // guaranteed to resolve consistently across every `fetch` implementation
  // (Node/Bun's global fetch requires an absolute URL and won't consult
  // `window.location` the way a browser's does).
  return new URL(`/courses/${encodeURIComponent(courseId)}/${relPath}`, window.location.origin).toString();
}

// Deliberately not a semver dependency — the manifest only ever needs a
// caret-major comparison ("^1" accepted, "^2" rejected). Five lines.
function assertRuntimeCompatible(range: string): void {
  const major = /^\^(\d+)/.exec(range)?.[1];
  if (major === undefined || Number(major) !== REQUIRED_RUNTIME_MAJOR) {
    throw new RuntimeMismatchError(range);
  }
}

function isManifestShape(value: unknown): value is Manifest {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    typeof m.title === 'string' &&
    typeof m.runtime === 'string' &&
    Array.isArray(m.parts)
  );
}

/**
 * TanStack Query key for a course's manifest — shared by every place that
 * fetches it (`CourseHome`, `Sidebar`) so they hit the same cache entry
 * instead of double-fetching the same static file.
 */
export function manifestQueryKey(courseId: string): readonly [string, string] {
  return ['course-manifest', courseId] as const;
}

/**
 * Fetches `/courses/<courseId>/manifest.json` and validates it before
 * handing it back: a non-2xx response throws `CourseFetchError`, a body
 * that isn't parseable/shaped JSON throws `ManifestParseError`, and a
 * `runtime` whose major version this app doesn't support throws
 * `RuntimeMismatchError`. Task 11 depends on this exact signature.
 */
export async function loadManifest(courseId: string): Promise<Manifest> {
  const url = assetUrl(courseId, 'manifest.json');
  const res = await fetch(url);
  if (!res.ok) {
    throw new CourseFetchError(url, res.status);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (cause) {
    throw new ManifestParseError(url, cause);
  }

  if (!isManifestShape(data)) {
    throw new ManifestParseError(url, new Error('response JSON is missing required manifest fields'));
  }

  assertRuntimeCompatible(data.runtime);
  return data;
}

/**
 * Fetches a chapter's HTML fragment as raw text, ready for Task 11 to
 * inject into `#content`. `file` is the manifest chapter's `file` field
 * (e.g. "chapters/p0-1.html"), relative to the course dir.
 */
export async function loadChapter(courseId: string, file: string): Promise<string> {
  const url = assetUrl(courseId, file);
  const res = await fetch(url);
  if (!res.ok) {
    throw new CourseFetchError(url, res.status);
  }
  return res.text();
}
