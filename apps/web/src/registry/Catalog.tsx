import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link } from 'react-router-dom';
import { coursesQueryKey } from '../api/courses';
import { describeFinding, type ImportStage } from '../course/import';
import { manifestQueryKey } from '../course/loader';
import { useLanguage } from '../i18n/LanguageProvider';
import { describeRegistryError } from './index.ts';
import { pullFromRegistry } from './pull.ts';
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
 * kind of screen (a list of courses with a language and a tier), a reader
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

export function Catalog({ registryBase }: { registryBase?: string }) {
  const { t } = useLanguage();
  const query = useRegistryIndex({ base: registryBase });
  const courses = query.data?.courses ?? NO_COURSES;

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
  const shown = active === '' ? courses : courses.filter((c) => c.lang === active);

  return (
    <div className="lib-page">
      <div className="lib-header">
        <div>
          <h1 className="ch-title">{t('catalog.title')}</h1>
          <p className="ch-lede">{t('catalog.lede')}</p>
        </div>
        <Link to="/library" className="btn">
          {t('catalog.yourLibrary')}
        </Link>
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
      {!query.isError && shown.length > 0 && (
        <ul className="lib-list" aria-label={t('catalog.listAria')}>
          {shown.map((course) => (
            <CatalogRow key={course.id} course={course} base={registryBase} />
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

function CatalogRow({ course, base }: { course: RegistryEntry; base?: string }) {
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
        // `configuredRegistryBase()` is deliberately NOT called here: this row
        // must pull from the same registry the index it came from was fetched
        // from. Reading the env var again would let a course listed by one
        // registry be downloaded from another.
        base: base ?? '',
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
        <TierBadge tier={course.tier} />
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
        The security sentence sits HERE — between the labels and the button,
        before the click, in the row it is about. `TierBadge`'s `title` says
        the same thing but only to a reader who hovers, and this is the one
        moment where the information can still change a decision: after the
        pull the JavaScript is already on the reader's device.
      */}
      {course.tier === 'interactive' && (
        <p className="lib-row-note lib-tier-warning">{t('catalog.pull.interactiveWarning')}</p>
      )}

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

/**
 * The tier badge, and the reason it says more than the word.
 *
 * Copied in substance from `pages/Library.tsx`'s badge, and for its reasons:
 * a tier is a SECURITY posture, not a content category. "interactive" on its
 * own reads as a promise about the content ("has simulations!"), which is the
 * opposite of what is being communicated — so the badge spells out that the
 * package is allowed to run JavaScript in the reader's browser.
 *
 * On the catalog this matters more than in the library, not less: here the
 * reader has not pulled the course yet, and this label is the last thing they
 * see before deciding to. An unknown tier is warned about rather than waved
 * through — reading a missing field as `content` would turn "we do not know
 * what this ships" into a silent all-clear.
 */
function TierBadge({ tier }: { tier: string }) {
  const { t } = useLanguage();

  if (tier === 'content') {
    return (
      <span
        className="lib-tier lib-tier-content"
        title={t('library.tier.contentTitle')}
      >
        content
      </span>
    );
  }
  if (tier === 'interactive') {
    return (
      <span
        className="lib-tier lib-tier-code"
        title={t('library.tier.interactiveTitle')}
      >
        {t('library.tier.interactiveLabel')}
      </span>
    );
  }
  return (
    <span
      className="lib-tier lib-tier-code"
      title={t('catalog.tier.unknownTitle')}
    >
      {t('library.tier.unknownLabel')}
    </span>
  );
}

export default Catalog;
