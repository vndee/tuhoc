/** A retry map is build-owned metadata, never a URL obtained from an error. */
export function resolveLabRetryUrl(value: unknown, kind: string, buildId: string, mapUrl: string, attempt: number): string {
  const unavailable = () => new Error('lab-retry-unavailable');
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 100) throw unavailable();
  if (typeof value !== 'object' || value === null) throw unavailable();
  const map = value as { buildId?: unknown; entries?: unknown };
  if (map.buildId !== buildId || typeof map.entries !== 'object' || map.entries === null || !Object.hasOwn(map.entries, kind)) throw unavailable();
  const entry = (map.entries as Record<string, unknown>)[kind];
  // Compiled files are siblings of the pinned map. Development uses only the
  // explicit source table provided by the same server instance.
  const compiled = typeof entry === 'string' && /^\.\/[A-Za-z0-9_-]+\.js$/.test(entry);
  const development = typeof entry === 'string' && buildId.startsWith('dev-') &&
    /^\/src\/stories\/labs\/[a-z-]+\/[A-Za-z]+Lab\.tsx$/.test(entry);
  if (!compiled && !development) throw unavailable();
  const url = new URL(entry as string, mapUrl);
  if (url.origin !== new URL(mapUrl).origin) throw unavailable();
  url.searchParams.set('lab-retry', String(attempt));
  return url.href;
}
