import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageProvider';
import { describeRegistryError } from './index.ts';
import type { RegistryEntry } from './types.ts';
import { useRegistryIndex } from './useRegistry.ts';

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
 */
export function Catalog({ registryBase }: { registryBase?: string }) {
  const { t } = useLanguage();
  const query = useRegistryIndex({ base: registryBase });
  const courses = query.data?.courses ?? [];

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

      {/*
        `!query.isError` is load-bearing, not defensive noise. TanStack Query
        KEEPS the last successful `data` when a later fetch fails, so without
        it a registry that has just been republished under a schema this build
        cannot read would render "nền tảng cần được cập nhật" directly above a
        list of courses drawn from the previous format — a warning and the
        thing it warns about, side by side. The stalest possible catalog is
        also the one most likely to offer a course that is no longer there.
      */}
      {!query.isError && courses.length > 0 && (
        <ul className="lib-list" aria-label={t('catalog.listAria')}>
          {courses.map((course) => (
            <CatalogRow key={course.id} course={course} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CatalogRow({ course }: { course: RegistryEntry }) {
  const { t } = useLanguage();

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
