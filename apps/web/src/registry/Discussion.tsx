import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  type DiscussionComment,
  discussionQueryKey,
  discussionReasonKey,
  fetchDiscussion,
  githubHref,
} from '../api/discussions';
import { useLanguage } from '../i18n/LanguageProvider';

/**
 * One course's GitHub discussion, embedded READ-ONLY.
 *
 * ## It does not fetch until the reader opens it, and that is a budget
 *
 * The GitHub token belongs to the PLATFORM, so the quota is global:
 * `internal/discuss` spends at most `MaxOutboundPerWindow` (30) real calls
 * per window **for everybody**. A twenty-row catalog that loaded every thread
 * on mount would spend two thirds of that in one page view, and the people
 * who paid for it would be the other readers, who would see `rate_limited`
 * for a thread nobody asked to see.
 *
 * So the request is behind a disclosure, and
 * `Catalog.rating.test.tsx` measures the property the way S2 Task 9 taught:
 * by counting **requests that actually leave the page**, not responses. A
 * version that fetched eagerly and hid the result would render identically.
 *
 * `staleTime` is the same idea one layer up: `internal/discuss` already
 * caches each thread with its own TTL, so asking again a few seconds later
 * can only return the same answer at the cost of the scarce thing.
 *
 * ## The reader may READ here and WRITES on GitHub
 *
 * There is no write route on our API at all (`TestDiscussionRouteContract`
 * pins the set to `GET`/`HEAD`), and this component has no form. The button
 * is a link out. That is the architecture, not a phase: comments live on
 * GitHub so that the platform never becomes the custodian of a stranger's
 * words, their edits, their deletions, or their moderation.
 *
 * ## `body` is markdown SOURCE, and it is drawn as TEXT
 *
 * Comments are written by the public — the most literally untrusted input
 * this application has. The API deliberately returns `body` and not
 * `bodyHTML` so that no markup the platform cannot vouch for ever reaches
 * it. Here that decision is honoured the only way it can be: the string
 * becomes a React text node. No `innerHTML`, no `dangerouslySetInnerHTML`,
 * and no markdown-to-HTML renderer either — this project patched a Critical
 * hole (S1-F43) that was exactly one HTML sink fed by package-controlled
 * data, and `db/local.test.ts`'s sink scan reads every file under
 * `apps/web/src` so that the next one cannot be added quietly.
 *
 * The visible consequence, stated rather than hidden: `**bold**` shows as
 * `**bold**`. Rendering it properly means a markdown parser and a sanitiser
 * on stranger-controlled input, which is a security project of its own and
 * not a formatting touch-up. `white-space: pre-wrap` at least keeps the
 * author's line breaks, which is most of what markdown is used for in a
 * comment thread.
 */

/** Long enough that opening, closing and reopening a row costs one call. */
const DISCUSSION_STALE_MS = 5 * 60_000;

export function Discussion({ registryId }: { registryId: string }) {
  const { t, lang } = useLanguage();
  const [open, setOpen] = useState(false);

  const query = useQuery({
    queryKey: discussionQueryKey(registryId),
    queryFn: () => fetchDiscussion(registryId),
    enabled: open,
    staleTime: DISCUSSION_STALE_MS,
    // A window refocus is not new information about a discussion, and it
    // WOULD be a new outbound call against a global budget. Same reasoning
    // as the disclosure above.
    refetchOnWindowFocus: false,
    // A malformed body or a 500 is exactly as malformed on the third try.
    // The reader gets a sentence instead of several seconds of a "loading"
    // state that is lying — the policy `useRegistry.ts` already wrote down.
    retry: false,
  });

  const panelId = `discussion-${registryId}`;

  return (
    <div className="discussion">
      <button
        type="button"
        className="btn"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
      >
        {t('discuss.toggle')}
      </button>

      {open && (
        <div id={panelId} className="discussion-panel">
          {query.isPending && <p role="status">{t('discuss.loading')}</p>}

          {/*
            An error is a SENTENCE here, never a throw. This block sits inside
            a catalog row; letting it reach `<ErrorBoundary>` would replace
            the whole screen — every other course, and the pull button the
            reader actually came for — because a third party's API was slow.
            That is the `815a472` shape re-created one layer up, and the
            reason `internal/discuss` answers 200 even when it failed.
          */}
          {query.isError && <p className="lib-notice">{t('discuss.error')}</p>}

          {query.isSuccess && !query.data.loaded && (
            <p className="lib-notice">{t(discussionReasonKey(query.data.reason))}</p>
          )}

          {query.isSuccess && query.data.loaded && query.data.comments.length === 0 && (
            <p className="lib-notice">{t('discuss.empty')}</p>
          )}

          {query.isSuccess && query.data.comments.length > 0 && (
            <ul className="discussion-list">
              {query.data.comments.map((comment) => (
                <CommentRow key={comment.id} comment={comment} lang={lang} />
              ))}
            </ul>
          )}

          {query.isSuccess && <PostOnGitHub url={query.data.url} />}
        </div>
      )}
    </div>
  );
}

function CommentRow({ comment, lang }: { comment: DiscussionComment; lang: string }) {
  const { t } = useLanguage();
  const when = new Date(comment.createdAt);
  const readable = Number.isNaN(when.getTime())
    ? null
    : when.toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

  return (
    <li className="discussion-comment">
      <p className="lib-meta">
        {/*
          An EMPTY author is a sentinel, not missing data: GitHub reports a
          deleted account that way, and the comment itself is still a real
          comment somebody wrote. The placeholder is ours and translated —
          the API refuses to put a Vietnamese sentence on the wire precisely
          so this choice lands here (see `apps/api`'s commit 42feca8).
        */}
        <span className="discussion-author">
          {comment.author === '' ? t('discuss.deletedAuthor') : comment.author}
        </span>
        {readable !== null && (
          <>
            <span className="lib-meta-sep" aria-hidden="true">
              ·
            </span>
            <time dateTime={comment.createdAt}>{readable}</time>
          </>
        )}
      </p>
      {/*
        A React TEXT NODE. See this file's header — the whole security
        argument of the `body`/`bodyHTML` split lands on this one line, and
        `Discussion.test.tsx` measures it at the DOM: a comment whose body is
        `<img src=x onerror=…>` must leave `document.querySelector('img')`
        null AND must still be on the page as characters.
      */}
      <p className="discussion-body" style={{ whiteSpace: 'pre-wrap' }}>
        {comment.body}
      </p>
    </li>
  );
}

/**
 * The way out to GitHub — or nothing at all.
 *
 * `null` rather than a dead button when {@link githubHref} refuses: an
 * anchor that goes nowhere is a control that lies, and one that goes
 * somewhere unexpected is worse. `url` is `''` on every checkout today
 * (nothing is configured), so "nothing at all" is the state this renders in
 * practice right now.
 */
function PostOnGitHub({ url }: { url: string }) {
  const { t } = useLanguage();
  const href = githubHref(url);
  if (href === null) return null;

  return (
    <p className="discussion-post">
      {/*
        `rel="noopener noreferrer"` with `target="_blank"`: without `noopener`
        the opened page gets a handle on this one through `window.opener` and
        can navigate it, and the destination is a page anybody with a GitHub
        account can put content on.
      */}
      <a href={href} target="_blank" rel="noopener noreferrer">
        {t('discuss.postOnGitHub')}
      </a>
    </p>
  );
}

export default Discussion;
