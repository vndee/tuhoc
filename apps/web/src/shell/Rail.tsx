import { useLocation } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageProvider';

// Matches the `/c/:courseId/:chapterId` route — deliberately not
// `useParams` (see Sidebar's own `courseIdFromPathname` for the same
// reasoning): <Rail> is chrome rendered by <AppShell> alongside
// <AppRoutes>, not inside a matched <Route>, so it only sees the pathname.
const CHAPTER_ROUTE = /^\/c\/[^/]+\/[^/]+/;

/**
 * Right-rail chrome. On chapter pages, `ChapterView` (Task 11) portals its
 * own in-page TOC directly into `#rail` — built from the chapter's own
 * h2/h3s, which this component has no way to know about — so this renders
 * nothing there and gets out of the way. Everywhere else it is a static
 * placeholder so `aside#rail` exists in the DOM skeleton from day one.
 */
export function Rail() {
  const location = useLocation();
  const { t } = useLanguage();
  if (CHAPTER_ROUTE.test(location.pathname)) return null;

  return (
    <>
      <p className="rail-h">{t('rail.inChapter')}</p>
      <p className="muted">{t('rail.empty')}</p>
    </>
  );
}
