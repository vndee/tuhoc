import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link } from 'react-router-dom';
import { coursesQueryKey } from '../api/courses';
import { type RatingSummary, fetchRatings, ratingsQueryKey } from '../api/ratings';
import { describeFinding, type ImportStage } from '../course/import';
import { manifestQueryKey } from '../course/loader';
import { useLanguage } from '../i18n/LanguageProvider';
import { Discussion } from './Discussion.tsx';
import { configuredRegistryBase, describeRegistryError } from './index.ts';
import { orderByRating } from './order.ts';
import { pullFromRegistry } from './pull.ts';
import { Rating } from './Rating.tsx';
import type { RegistryEntry } from './types.ts';
import { useRegistryIndex } from './useRegistry.ts';
import type { Finding } from '@tuhoc/course-format';
import type { MessageKey } from '../i18n';

/**
 * `/catalog` — the community registry, browsed from one fetched file.
 *
 * ## Why every failure here is a message and not a thrown error
 *
 * `<ErrorBoundary>` already wraps `<AppRoutes>` (see `App.tsx`), and it is the
 * LAST net rather than the answer. A screen that let a bad `index.json` throw
 * during render would be "fixed" in the sense that the page is no longer
 * white, and broken in the sense that the reader is told *"Màn hình này gặp
 * lỗi"* — a sentence that names neither the registry, nor the field, nor
 * whether the fault is theirs, the registry's, or this build's age. So the
 * catalog answers for itself: the query's `error` is turned into one of five
 * distinct sentences by `describeRegistryError`, and
 * `Catalog.test.tsx` asserts the boundary's wording is ABSENT in every one of
 * those cases — a green test that only proved "the net caught it" would have
 * proved nothing about this file.
 *
 * The invariant that makes this hold: **nothing rendered below reads a field
 * `assertRegistryIndex` has not already checked at the boundary.** That is
 * why `entryProblems` descends into each entry — `VersionLine` reads
 * `versions.length`, and an entry without `versions` would throw here, in
 * render, where there is no error path at all.
 *
 * ## Styling reuses `.lib-*`
 *
 * Deliberately, not out of laziness: the catalog and the library are the same
 * kind of screen (a list of courses with a language and a version), a reader
 * moves between them, and a second visual vocabulary for the same object is
 * how two screens drift into looking like two products. It also keeps this
 * task out of `styles/index.css`, which nothing here needed to change.
 *
 * ## HC-3: the half of `lang` that never existed
 *
 * Spec §4.2 says the catalog *"filters and displays"* on `lang`. Measured
 * before this change, `lang` appeared in exactly two places in the whole app
 * — both in `pages/Library.tsx`, both drawing text. Nothing read it to decide
 * anything. {@link LangFilter} is the missing half, and the two rules it
 * follows are both written down elsewhere in this subsystem:
 *
 *   1. **The options come from the data, never from `LANGS`.** A course's
 *      `lang` is a free-form label from its manifest (`registry/types.ts`:
 *      *"Nothing translates on it"*) — a course may be written in any
 *      language, while `LANGS` is the two languages the *interface* speaks.
 *      Filtering by the interface's list would make a French course
 *      unreachable by a control that appeared to work.
 *   2. **Filtering never hides silently.** `registry/index.ts` refuses to drop
 *      a malformed entry and render the rest, because *"a course silently
 *      invisible with no message anywhere"* is the shape of this project's
 *      five recorded blind gates. A filter hides courses by design, so it has
 *      to say how many, every time, and be undoable in one click.
 */
/**
 * One shared empty array, so `courses` keeps a STABLE identity while the query
 * is pending.
 *
 * `query.data?.courses ?? []` allocates a fresh array on every render, which
 * makes any `useMemo` keyed on it recompute every time — a memo that measures
 * nothing. `oxlint`'s `exhaustive-deps` says so out loud, and the honest fix is
 * the stable value rather than a suppression: TanStack Query hands back the
 * same `courses` reference for as long as the data is unchanged, so with this
 * the memo tracks exactly what it claims to.
 */
const NO_COURSES: readonly RegistryEntry[] = [];

/** Same shared-empty-value reason as {@link NO_COURSES}, for the ratings query. */
const NO_RATINGS: readonly RatingSummary[] = [];

/** How long a page of ratings is fresh before a background refetch. */
const RATINGS_STALE_MS = 60_000;

/**
 * Ratings for exactly the courses this catalog page listed — one request for
 * the whole page, and the request that carries the privacy barrier.
 *
 * ## `ids` comes from `index.json` and from nowhere else
 *
 * `GET /ratings` refuses to answer without `?ids=` (400, by design). The Go
 * side cannot check whether an id is a registry id — it never reads the
 * registry, and `TestAPIProductCodeMakesNoOutboundCall` is why it never
 * will — so its barrier is *"no route enumerates"*, and that holds exactly
 * as long as the ids clients send are ids the public index already
 * published. This hook is where that becomes true: its only input is
 * `query.data.courses`.
 *
 * ## It never blocks the list
 *
 * Spec §1.1 promises a self-hosted build can read the public registry in
 * read-only mode — a build with no `apps/api` at all, where this request can
 * only fail. So the rows render from the index alone and ratings decorate
 * them when they arrive. Making the catalog wait would hand a registry
 * feature to a server the architecture says is optional.
 *
 * `retry: false` for the same reason `useRegistry.ts` refuses blanket
 * retries: a malformed body is exactly as malformed on the third attempt,
 * and a rating is a decoration on a screen whose job — listing and pulling
 * courses — is already done.
 */
function useRatings(ids: readonly string[]) {
  const query = useQuery({
    queryKey: ratingsQueryKey(ids),
    queryFn: () => fetchRatings(ids),
    enabled: ids.length > 0,
    staleTime: RATINGS_STALE_MS,
    retry: false,
  });

  const rows = query.data ?? NO_RATINGS;
  return useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
}

/**
 * The registry a ROW must pull from — the same one the index came from.
 *
 * `useRegistryIndex({ base: undefined })` falls through to
 * `configuredRegistryBase()` inside `fetchRegistryIndex`, so in a real build
 * the prop is absent and the base lives only in the env var. A row that read
 * the prop and defaulted to `''` would build `/courses/<id>/<v>.zip` —
 * relative to **this app's** origin, not the registry's. That is not a 404
 * a reader could diagnose: an SPA host answers an unknown path with its own
 * `index.html`, so the importer would report `NOT_A_ZIP` on a package that is
 * perfectly fine and sitting somewhere else entirely. Exactly the `815a472`
 * shape — HTML arriving where bytes were expected — one layer down.
 *
 * `null` when nothing is configured, and the `try` is the whole reason this is
 * a function: `configuredRegistryBase()` THROWS in that case, and throwing
 * during render is how this screen would hand its job to `<ErrorBoundary>`.
 * The query has already failed with the same error and the catalog is already
 * showing the sentence that names `VITE_REGISTRY_URL`, so there is nothing to
 * say here — and no rows to say it on.
 */
function pullBase(prop: string | undefined): string | null {
  if (prop !== undefined) return prop;
  try {
    return configuredRegistryBase();
  } catch {
    return null;
  }
}

export function Catalog({ registryBase }: { registryBase?: string }) {
  const { t } = useLanguage();
  const query = useRegistryIndex({ base: registryBase });
  const courses = query.data?.courses ?? NO_COURSES;
  const base = pullBase(registryBase);

  /** `''` is "all". Not `null`, so it is the `<select>`'s value directly. */
  const [lang, setLang] = useState('');

  // Sorted, so the control's order does not depend on the order the registry
  // happened to list courses in — two indexes with the same courses must give
  // the same control.
  const langs = useMemo(() => [...new Set(courses.map((c) => c.lang))].sort(), [courses]);

  // A label can leave the index between renders (the registry republished, or
  // the query settled into an error). Holding a filter nobody can see the
  // control for would show an empty list with no way back.
  const active = langs.includes(lang) ? lang : '';
  // Memoised, not computed inline: `filter` allocates a fresh array on every
  // render, and `ordered` below is keyed on it. Same lesson `NO_COURSES`
  // above was written for — a memo whose input changes identity every render
  // is a memo that measures nothing.
  const shown = useMemo(
    () => (active === '' ? courses : courses.filter((c) => c.lang === active)),
    [courses, active],
  );

  // Asked about EVERY course the index listed, not just the ones the language
  // filter is showing: the filter is a view, and refetching a different id set
  // every time the reader changes it would spend requests to learn nothing new.
  const ids = useMemo(() => courses.map((c) => c.id), [courses]);
  const ratings = useRatings(ids);

  const ordered = useMemo(() => orderByRating(shown, ratings), [shown, ratings]);

  return (
    <div className="lib-page">
      {/*
        `h2`, và KHÔNG còn nút "Thư viện của bạn".
        Màn này nay là tab "Kho cộng đồng" bên trong `/courses`, nơi `h1` là
        "Khoá học" và thư viện của người đọc là **tab ngay bên cạnh** — một nút
        dẫn sang chỗ cách đó một cú bấm là đúng thứ "hai cửa cho cùng một chỗ"
        mà `Dashboard.tsx` đã gỡ một lần rồi. Nhan đề thì ở lại: nó nói tab này
        đang cho xem cái gì, và `registry/route.test.tsx` neo vào nó để chứng
        minh màn hình vẫn đứng khi `index.json` hỏng.
      */}
      <div className="lib-header">
        <div>
          <h2 className="ch-title">{t('catalog.title')}</h2>
          <p className="ch-lede">{t('catalog.lede')}</p>
        </div>
      </div>

      {query.isPending && (
        <p className="lib-notice" role="status">
          {t('catalog.loading')}
        </p>
      )}

      {query.isError && (
        <p className="lib-notice lib-notice-server" role="alert">
          {describeRegistryError(query.error, t)}
        </p>
      )}

      {query.isSuccess && courses.length === 0 && (
        <p className="lib-notice" role="status">
          {t('catalog.empty')}
        </p>
      )}

      {!query.isError && courses.length > 0 && (
        <div className="lib-filter">
          <label htmlFor="catalog-lang">{t('catalog.filter.lang')}</label>
          <select id="catalog-lang" value={active} onChange={(e) => setLang(e.target.value)}>
            <option value="">{t('catalog.filter.allLangs')}</option>
            {langs.map((code) => (
              // The label is drawn EXACTLY as the manifest wrote it. Mapping
              // `vi` to "Tiếng Việt" would need a table of every language a
              // contributor might use, and would quietly print the wrong name
              // for anything not in it.
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          <span className="lib-meta" data-testid="catalog-filter-count" role="status">
            {t('catalog.filter.count', String(shown.length), String(courses.length))}
          </span>
        </div>
      )}

      {/*
        `!query.isError` is load-bearing, not defensive noise. TanStack Query
        KEEPS the last successful `data` when a later fetch fails, so without
        it a registry that has just been republished under a schema this build
        cannot read would render "nền tảng cần được cập nhật" directly above a
        list of courses drawn from the previous format — a warning and the
        thing it warns about, side by side. The stalest possible catalog is
        also the one most likely to offer a course that is no longer there.
      */}
      {!query.isError && base !== null && ordered.length > 0 && (
        <ul className="lib-list" aria-label={t('catalog.listAria')}>
          {ordered.map((course) => (
            <CatalogRow key={course.id} course={course} base={base} rating={ratings.get(course.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Which sentence goes with which phase of `importCourse`. */
const STAGE_KEY: Readonly<Record<ImportStage, MessageKey>> = {
  fetching: 'import.stage.fetching',
  unpacking: 'import.stage.unpacking',
  checking: 'import.stage.checking',
  saving: 'import.stage.saving',
};

type PullState =
  | { phase: 'idle' }
  | { phase: 'running'; stage: ImportStage }
  | { phase: 'done'; version: string }
  | { phase: 'failed'; findings: readonly Finding[] };

function CatalogRow({
  course,
  base,
  rating,
}: {
  course: RegistryEntry;
  base: string;
  /**
   * `undefined` means the ratings request has not answered — or could not.
   *
   * The row then draws NO star control at all, rather than an empty one.
   * Five blank stars would say "you have not voted", and the truth is that
   * this build does not know: a reader who had voted 5 would be shown their
   * own vote as absent, and a click meant to keep it would be a new write
   * against a state nobody read.
   */
  rating: RatingSummary | undefined;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [pull, setPull] = useState<PullState>({ phase: 'idle' });

  async function run() {
    // `flushSync`, for the reason `pages/ImportCourse.tsx` measured in a real
    // browser: `importCourse` ends its task after each stage so the browser
    // can draw, but ending the task does not make React's scheduler have run
    // by then. Without this the stage line commits inside the same task as
    // the ~1 s validation scan and is never seen.
    flushSync(() => setPull({ phase: 'running', stage: 'fetching' }));
    let result;
    try {
      result = await pullFromRegistry(course, {
        // Resolved ONCE by the parent, from the same value the index was
        // fetched with — see `pullBase`. A row must never re-derive it: a
        // course listed by one registry being downloaded from another is a
        // supply-chain swap with a plausible-looking URL.
        base,
        t,
        onStage: (stage) => flushSync(() => setPull({ phase: 'running', stage })),
      });
    } catch (cause) {
      // `importCourse` promises never to throw and has its own net, so getting
      // here means that promise was broken. A page must still say something
      // rather than trust a contract — `pages/ImportCourse.tsx` reached this
      // branch as a BLANK SCREEN once, from a response body cut mid-package.
      setPull({
        phase: 'failed',
        findings: [{ code: 'UNEXPECTED', path: '.', detail: `(${cause instanceof Error ? cause.message : String(cause)})` }],
      });
      return;
    }

    if (result.ok) {
      setPull({ phase: 'done', version: result.version });
      // The library and this course's manifest are both stale now — same two
      // invalidations `pages/ImportCourse.tsx` does, for the same reason: a
      // reader who pulls and clicks straight through would otherwise get the
      // copy that was there before.
      await queryClient.invalidateQueries({ queryKey: coursesQueryKey() });
      await queryClient.invalidateQueries({ queryKey: manifestQueryKey(result.courseId) });
    } else {
      setPull({ phase: 'failed', findings: result.findings });
    }
  }

  return (
    <li className="lib-item lib-item-registry">
      <div className="lib-item-head">
        <span className="lib-item-title">{course.title}</span>
      </div>
      <p className="lib-meta">
        <span className="lib-meta-part">{course.lang}</span>
        <span className="lib-meta-sep" aria-hidden="true">
          ·
        </span>
        <span className="lib-meta-part">{t('library.meta.version', course.latest)}</span>
        {course.versions.length > 1 && (
          <>
            <span className="lib-meta-sep" aria-hidden="true">
              ·
            </span>
            <span className="lib-meta-part">{t('catalog.versionCount', String(course.versions.length))}</span>
          </>
        )}
      </p>
      {course.description !== '' && <p className="lib-row-note">{course.description}</p>}

      {/*
        The star control lives HERE and only here. Every row on this screen
        came from `index.json`, which is what makes a rating legitimate at
        all — see `Rating.tsx`'s header and `ratingFence.test.tsx`, which
        holds the whole app to that and goes red for a `<Rating>` added to
        any screen that draws private or file-imported courses.
      */}
      {rating !== undefined && <Rating registryId={course.id} summary={rating} />}

      <div className="lib-item-actions">
        <button
          type="button"
          className="btn"
          disabled={pull.phase === 'running' || pull.phase === 'done'}
          onClick={() => void run()}
        >
          {t('catalog.pull.action')}
        </button>

        {pull.phase === 'running' && (
          <span className="lib-meta" role="status">
            {t(STAGE_KEY[pull.stage])}
          </span>
        )}

        {pull.phase === 'done' && (
          <span className="lib-meta" role="status">
            {t('catalog.pull.done', course.title, pull.version)}
            <Link to={`/c/${course.id}`}>{t('catalog.pull.open')}</Link>
          </span>
        )}

        {/*
          Read-only, and it fetches NOTHING until the reader opens it. The
          GitHub token is the platform's, so its quota is everybody's: twenty
          rows loading eagerly would spend two thirds of the global window on
          one page view. See `Discussion.tsx`.
        */}
        <Discussion registryId={course.id} />
      </div>

      {/*
        Every finding, not the first. `validatePackage` was built to report all
        of them at once (see its doc comment), and a registry package that
        fails here is one whose author needs the whole list — the same
        courtesy `pages/ImportCourse.tsx` extends to a dragged file.
      */}
      {pull.phase === 'failed' && (
        <div className="lib-notice lib-notice-server" role="alert">
          <p>{t('catalog.pull.failed', course.title)}</p>
          <ul>
            {pull.findings.map((f, i) => (
              <li key={`${f.code}-${f.path}-${i}`}>{describeFinding(f, t)}</li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

export default Catalog;
