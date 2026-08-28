/**
 * The client half of `GET /discussions/:registryId` —
 * `apps/api/internal/discuss/handler.go`'s `threadResponse`, field for field.
 *
 * ```
 * GET /discussions/:registryId → 200 ALWAYS (400 only for a malformed id)
 * { id, loaded, reason, url, comments: [{ id, author, body, createdAt }] }
 * ```
 *
 * ## Three properties of that contract this file is built on
 *
 * 1. **`reason` is a CLOSED VOCABULARY, not a sentence.** The API deliberately
 *    ships a code and not prose, because prose on the wire is prose nobody
 *    can translate — and this repo's i18n gate forbids a hardcoded string
 *    anywhere under the four scanned trees. So `apps/web` owns the sentence.
 *    {@link DISCUSSION_REASONS} is that vocabulary, and
 *    {@link discussionReasonKey} is the only mapping from it to words.
 *
 * 2. **`body` is markdown SOURCE, not `bodyHTML`, on purpose.** Comments are
 *    written by the public. `bodyHTML` would be markup the platform did not
 *    produce and cannot vouch for, one `dangerouslySetInnerHTML` away from
 *    running in a reader's session. `Discussion.tsx` therefore draws it as
 *    TEXT — see that file, and `db/local.test.ts`'s HTML-sink scan, which
 *    would catch any attempt to do otherwise anywhere under `apps/web/src`.
 *
 * 3. **`comments` is never `null`.** The Go side guarantees it at every exit
 *    (mutant M4 of `task-5-go-report.md` kills the version that does not),
 *    and {@link assertDiscussion} still checks — because the guarantee is
 *    made by a different process, in a different repository half, on a
 *    different deploy cycle, and `.map` on a `null` is exactly the crash that
 *    white-screened this app once already (`4f2bf1f`).
 *
 * ## Today, `reason` is always `"disabled"`
 *
 * There is no public registry repository yet (`docs/deploy.md` §5c) and no
 * GitHub token, so every checkout and production itself answer `loaded:
 * false, reason: "disabled", url: "", comments: []`. That is the state the
 * interface is built for first, and `Discussion.test.tsx` opens with it.
 */

import { api, type RequestOptions } from './client';
import type { MessageKey } from '../i18n';

/** One comment, reduced to the four fields the platform is given. */
export interface DiscussionComment {
  readonly id: string;
  /**
   * The commenter's GitHub login, or `''`.
   *
   * `''` is a **sentinel**, not missing data: it means the account that wrote
   * this comment has been deleted. The comment itself still stands, and
   * `Discussion.tsx` draws a translated placeholder for it rather than a gap.
   */
  readonly author: string;
  /** Markdown SOURCE. Never HTML — see this module's header, point 2. */
  readonly body: string;
  readonly createdAt: string;
}

export interface DiscussionThread {
  readonly id: string;
  /** `true` only when a real thread was read. `false` carries a `reason`. */
  readonly loaded: boolean;
  /** One of {@link DISCUSSION_REASONS} — or anything, if a newer server says so. */
  readonly reason: string;
  /** The GitHub page to post on. `''` when there is nowhere to send anyone. */
  readonly url: string;
  /** Never `null` after this boundary. Empty means "nobody has commented". */
  readonly comments: readonly DiscussionComment[];
}

/**
 * The closed vocabulary, exactly as `internal/discuss` writes it.
 *
 *   `''`            — nothing went wrong (paired with `loaded: true`)
 *   `disabled`      — no registry repository / no token is configured
 *   `unavailable`   — GitHub answered with something unusable, or not at all
 *   `rate_limited`  — the platform's own global outbound budget is spent
 *
 * Listed as data rather than as a union of string literals alone so a test
 * can assert the list has not quietly grown a fifth member that no sentence
 * exists for.
 */
export const DISCUSSION_REASONS: readonly string[] = ['', 'disabled', 'unavailable', 'rate_limited'];

/**
 * A 200 whose body is not a thread.
 *
 * Thrown, not swallowed into a `loaded: false` value, and the difference is
 * visible to the reader: this is *"we could not read the answer"*, which is
 * a different fact from *"GitHub is not configured"*. Collapsing them would
 * make a broken deploy look like an intentional setting. The query's error
 * state already produces the right sentence — `Discussion.tsx` never lets it
 * reach `<ErrorBoundary>`.
 */
export class MalformedDiscussionError extends Error {
  // Khai tường minh: `erasableSyntaxOnly` cấm tham số-thuộc tính (TS1294).
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`/discussions response malformed at: ${problems.join(', ')}`);
    this.name = 'MalformedDiscussionError';
    this.problems = problems;
  }
}

/** Shape check at the boundary. Comments are REBUILT from four fields, never passed through. */
export function assertDiscussion(body: unknown): DiscussionThread {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new MalformedDiscussionError(['(response body is not an object)']);
  }
  const o = body as Record<string, unknown>;
  const problems: string[] = [];

  if (typeof o.id !== 'string') problems.push('id');
  if (typeof o.loaded !== 'boolean') problems.push('loaded');
  if (typeof o.reason !== 'string') problems.push('reason');
  if (typeof o.url !== 'string') problems.push('url');

  const comments: DiscussionComment[] = [];
  if (!Array.isArray(o.comments)) {
    problems.push('comments');
  } else {
    o.comments.forEach((raw: unknown, i) => {
      if (typeof raw !== 'object' || raw === null) {
        problems.push(`comments[${i}]`);
        return;
      }
      const c = raw as Record<string, unknown>;
      if (typeof c.id !== 'string') problems.push(`comments[${i}].id`);
      // `author` may be `''` — the deleted-account sentinel. It may not be
      // absent: that would be a shape this app does not know how to draw.
      if (typeof c.author !== 'string') problems.push(`comments[${i}].author`);
      if (typeof c.body !== 'string') problems.push(`comments[${i}].body`);
      if (typeof c.createdAt !== 'string') problems.push(`comments[${i}].createdAt`);
      comments.push({
        id: c.id as string,
        author: c.author as string,
        body: c.body as string,
        createdAt: c.createdAt as string,
      });
    });
  }

  if (problems.length > 0) throw new MalformedDiscussionError(problems);

  return {
    id: o.id as string,
    loaded: o.loaded as boolean,
    reason: o.reason as string,
    url: o.url as string,
    comments,
  };
}

/**
 * The `url` a link may point at, or `null`.
 *
 * **`href` is a sink.** A `javascript:` URL in an anchor runs in the
 * reader's session with the reader's cookies, which is the same class of
 * hole as an `innerHTML` fed by data somebody else controls — the one this
 * project patched as Critical (S1-F43). The Go side already pins `url` to
 * the configured repository at its own boundary and answers `unavailable`
 * for anything else; this is the second lock, and it is not redundant for
 * the reason `db/local.test.ts` refuses "somewhere else already checks it":
 * that lock lives in another process, another language, another deployment.
 *
 * `new URL(raw)` with no base is doing real work here, not cosmetics — it is
 * why `//host/x`, `/discussions/7` and `` (relative or empty) are rejected
 * rather than resolved against this page's origin.
 */
export function githubHref(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw === '') return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  // `protocol` is lower-cased by the URL parser, so `JavaScript:` is caught.
  if (parsed.protocol !== 'https:') return null;
  // Exact host. `github.com.example.vn` and `example.vn/github.com` are not
  // GitHub, and an `endsWith` check would accept the first of them.
  if (parsed.hostname !== 'github.com') return null;
  return parsed.toString();
}

/** Which sentence goes with which reason code. */
const REASON_KEY: Readonly<Record<string, MessageKey>> = {
  disabled: 'discuss.reason.disabled',
  unavailable: 'discuss.reason.unavailable',
  rate_limited: 'discuss.reason.rateLimited',
};

/**
 * The message key for a reason code — falling back to the generic one.
 *
 * The fallback is what keeps a server-written token off the screen. A newer
 * API answering `quota_exceeded_v2` must produce a Vietnamese sentence, not
 * the token itself: untranslatable text drawn straight from a response is
 * the exact habit the i18n gate exists to prevent, and it would be text this
 * app never chose the wording of.
 */
export function discussionReasonKey(reason: string): MessageKey {
  return REASON_KEY[reason] ?? 'discuss.reason.unknown';
}

/** TanStack Query key — one entry per course, never shared. */
export function discussionQueryKey(registryId: string): readonly ['discussions', string] {
  return ['discussions', registryId] as const;
}

export async function fetchDiscussion(registryId: string, options: RequestOptions = {}): Promise<DiscussionThread> {
  return assertDiscussion(await api.get<unknown>(`/discussions/${encodeURIComponent(registryId)}`, options));
}
