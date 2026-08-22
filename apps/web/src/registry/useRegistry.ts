import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { fetchRegistryIndex, isRegistryDataError } from './index.ts';
import type { RegistryIndex } from './types.ts';

/**
 * TanStack Query key for the registry catalog, shared by every surface that
 * reads it — same convention as `statsQueryKey`/`manifestQueryKey`.
 *
 * The base is part of the key. Two different registries are two different
 * catalogs, and keying them together would serve one build's data to another
 * after a configuration change.
 */
export function registryIndexQueryKey(base: string): readonly ['registry', 'index', string] {
  return ['registry', 'index', base] as const;
}

/** How long the catalog is considered fresh before a background refetch. */
const CATALOG_STALE_MS = 5 * 60_000;

/** At most this many retries, and only for failures where retrying can change the answer. */
const MAX_TRANSPORT_RETRIES = 2;

/**
 * Retry policy, extracted so it is testable without a network.
 *
 * A malformed index, an unknown schema, or a body that is not JSON will be
 * exactly as malformed on the third attempt as on the first. Retrying them
 * only delays the message while the screen shows a "loading" state that is
 * lying — and the default policy (three retries with backoff) turns an
 * instant, correct error into several seconds of one.
 */
export function shouldRetryRegistry(failureCount: number, error: unknown): boolean {
  if (isRegistryDataError(error)) return false;
  return failureCount < MAX_TRANSPORT_RETRIES;
}

export interface UseRegistryIndexOptions {
  /** Override the configured registry. Used by tests and by the Catalog's own prop. */
  base?: string;
}

/**
 * The catalog, as a query.
 *
 * Note what is NOT here: no `throwOnError`. A rejected `queryFn` becomes
 * `query.error`, which the caller renders as a message; letting it throw
 * during render would hand the problem to `<ErrorBoundary>`, and the boundary
 * is the last net rather than the answer — see `Catalog.tsx`.
 */
export function useRegistryIndex(options: UseRegistryIndexOptions = {}): UseQueryResult<RegistryIndex, Error> {
  const { base } = options;
  return useQuery<RegistryIndex, Error>({
    // `base ?? ''` only when unconfigured, where `queryFn` throws
    // `RegistryNotConfiguredError` before any request is made.
    queryKey: registryIndexQueryKey(base ?? ''),
    queryFn: ({ signal }) => fetchRegistryIndex({ base, signal }),
    staleTime: CATALOG_STALE_MS,
    retry: shouldRetryRegistry,
  });
}
