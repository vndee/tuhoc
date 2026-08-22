import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useLogout } from '../auth/useLogout';
import { type CourseStat, type DayStat, fetchStats, statsQueryKey } from '../api/stats';
import { useMe } from '../api/useMe';
import { describeCourseError, loadManifest, manifestQueryKey } from '../course/loader';
import { useOwnedCourses } from '../course/owned';
import type { Manifest } from '../course/types';
import { useLanguage } from '../i18n/LanguageProvider';
import { useProgress } from '../progress/useProgress';
import { EmptyLibrary } from './Library';

/**
 * `GET /stats`, for the study-time panel.
 *
 * The shape, the key and the call now live in `api/stats.ts`: `course/owned.ts`
 * reads `stats.courses` to answer which courses this reader has, and one
 * endpoint declared in two files is where the drift lives. Both callers use the
 * same query key, so this is one request, not two.
 */
function useStats() {
  return useQuery({
    queryKey: statsQueryKey(),
    queryFn: () => fetchStats(),
    retry: false,
  });
}

/**
 * `/` — the dashboard: one card per course (title, completion ring,
 * chapters done), plus a study-time summary (streak, total minutes, and a
 * 30-day bar chart) and a logout control (debt #3 — see `useLogout`'s own
 * doc comment for the full reasoning on placement and local-data
 * clearing).
 *
 * Ruling F5: the per-course completion PERCENTAGE always comes from
 * `useProgress` (local, via `CourseCard` below) — never from
 * `stats.courses[].chaptersDone`, which this component only ever uses as
 * the course card's secondary "phút đã học" figure. Study minutes,
 * streak, and the 30-day chart all come from `GET /stats` and nowhere
 * else, per the same ruling.
 */
export function Dashboard() {
  const { t } = useLanguage();
  const meQuery = useMe();
  const logout = useLogout();
  const statsQuery = useStats();
  // The one answer to "which courses does this reader have" — ruling S1-F31.
  // `/library` asks the same function the same question; before this they used
  // two different formulas and disagreed on screen, seconds apart.
  const owned = useOwnedCourses();
  const courseIds = owned.courses.map((course) => course.courseId);

  return (
    <div className="dashboard">
      <div className="dash-header">
        <div>
          <h1 className="ch-title">{t('nav.dashboard')}</h1>
          <p className="ch-lede">{t('dashboard.lede')}</p>
        </div>
        <div className="dash-user">
          {meQuery.data && <span className="dash-user-name">{meQuery.data.name}</span>}
          {/*
            The only way in to `/library` (Task 9), for the same reason the
            `/import` link below it exists at all.
          */}
          <Link to="/library" className="btn">
            {t('nav.library')}
          </Link>
          {/*
            The only way in to `/import` (Task 8). A route with no link is a
            route nobody uses: this page's own empty state has told readers
            to "nhập một gói course" since Task 7 without ever saying where.
          */}
          <Link to="/import" className="btn">
            {t('nav.import')}
          </Link>
          <button type="button" className="btn" onClick={() => void logout()}>
            {t('dashboard.logout')}
          </button>
        </div>
      </div>

      <StatsSummary statsQuery={statsQuery} />

      <div className="dash-cards">
        {courseIds.map((courseId) => (
          <CourseCard key={courseId} courseId={courseId} statsCourses={statsQuery.data?.courses} />
        ))}
      </div>

      {/*
        An empty catalog is now a state this page can genuinely be in — a
        new account holds no packages until it imports one — where before
        the hardcoded course id made it unreachable. Saying so beats
        rendering an empty strip that reads as a broken page.

        Gated on every SOURCE having settled, not merely on the list being
        empty: while any of the four is still in flight the answer is "we do
        not know yet", and flashing "you have no courses" at a learner who
        has several is worse than showing nothing for a moment. `settled`
        comes from `useOwnedCourses` rather than from one query here, which
        is the same widening as the union itself — this used to watch only
        `GET /courses`.

        The state itself is `<EmptyLibrary>` (pages/Library.tsx) rather than
        a line of prose local to this file, and that is ruling S1-F17 being
        applied where it actually lands: `/` is what a brand-new account
        opens, so this IS the front door, and Task 6's deletion of
        `KNOWN_COURSE_IDS` means every new reader stands here with nothing.
        One sentence pointing at /import was the old answer; the shared
        component names why the library is empty (a deliberate choice —
        §9.5), hands over the action, and lists the three ways in. Sharing
        it with `/library` is the point: two copies of a front door drift,
        and the copy that drifts is the one nobody who already has courses
        ever sees.
      */}
      {courseIds.length === 0 && owned.settled && <EmptyLibrary />}
    </div>
  );
}

interface StatsSummaryProps {
  statsQuery: ReturnType<typeof useStats>;
}

/**
 * Judgment call: what the study-time panel shows while `GET /stats` is
 * pending, or when it fails (offline, 5xx, ...). Neither state renders a
 * blank panel or a spinner that could hang forever — `useStats` sets
 * `retry: false`, so "pending" here resolves to either success or error
 * after exactly one request, same rationale as `useMe`'s own
 * `retry: false`. On error, this shows a short, honest Vietnamese
 * explanation instead of silently hiding the whole section — a learner
 * who is offline should see "cần kết nối mạng," not wonder whether the
 * feature is broken or just missing. The per-course completion ring
 * elsewhere on this page is unaffected either way (Ruling F5 — it is
 * local, not sourced from this query at all).
 */
function StatsSummary({ statsQuery }: StatsSummaryProps) {
  const { t } = useLanguage();

  if (statsQuery.isPending) {
    return <p className="dash-stats-note">{t('dashboard.stats.loading')}</p>;
  }

  if (statsQuery.isError) {
    return <p className="dash-stats-note">{t('dashboard.stats.error')}</p>;
  }

  const stats = statsQuery.data;
  return (
    <>
      <div className="dash-summary">
        <div className="dash-stat">
          <span className="dash-stat-v">{stats.streakDays}</span>
          <span className="dash-stat-k">{t('dashboard.stats.streakDays')}</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-v">{Math.round(stats.totalMinutes)}</span>
          <span className="dash-stat-k">{t('dashboard.stats.totalMinutes')}</span>
        </div>
      </div>
      <DayChart days={stats.days} />
    </>
  );
}

function DayChart({ days }: { days: DayStat[] }) {
  const { t } = useLanguage();
  const maxMinutes = Math.max(1, ...days.map((d) => d.minutes));
  return (
    <div className="dash-chart" aria-label={t('dashboard.chart.aria')}>
      {days.map((d) => {
        const heightPct = d.minutes > 0 ? Math.max(4, (d.minutes / maxMinutes) * 100) : 0;
        return (
          <div key={d.date} className="dash-bar" title={t('dashboard.chart.barTitle', d.date, String(Math.round(d.minutes)))}>
            <div className="dash-bar-fill" style={{ height: `${heightPct}%` }} />
          </div>
        );
      })}
    </div>
  );
}

interface CourseCardProps {
  courseId: string;
  statsCourses: CourseStat[] | undefined;
}

/**
 * One course's card: title + description come from the manifest (already
 * fetched elsewhere in the app under the same `manifestQueryKey`, so this
 * is typically a cache hit, not a second network round trip); the
 * completion ring's percentage comes from `useProgress` — LOCAL data
 * (Ruling F5) — divided by the manifest's own total chapter count; the
 * secondary "phút đã học" figure, when available, comes from
 * `stats.courses[].minutes` for this courseId.
 */
function CourseCard({ courseId, statsCourses }: CourseCardProps) {
  const { t } = useLanguage();
  const manifestQuery = useQuery({
    queryKey: manifestQueryKey(courseId),
    queryFn: () => loadManifest(courseId),
  });
  const { partStats } = useProgress(courseId);

  if (manifestQuery.isPending) {
    return <div className="dash-card dash-card-pending">{t('dashboard.card.loading')}</div>;
  }
  if (manifestQuery.isError) {
    return <div className="dash-card dash-card-error">{describeCourseError(manifestQuery.error, t)}</div>;
  }

  const manifest: Manifest = manifestQuery.data;
  const totalChapters = manifest.parts.reduce((sum, part) => sum + part.chapters.length, 0);
  const percent = totalChapters > 0 ? Math.round((partStats.chaptersRead / totalChapters) * 100) : 0;
  const courseMinutes = statsCourses?.find((c) => c.courseId === courseId)?.minutes;

  return (
    <Link to={`/c/${courseId}`} className="dash-card">
      <CompletionRing percent={percent} />
      <div className="dash-card-body">
        <h3 className="dash-card-title">{manifest.title}</h3>
        <p className="dash-card-progress">
          {t('dashboard.card.chaptersRead', String(partStats.chaptersRead), String(totalChapters))}
          {courseMinutes != null ? t('dashboard.card.minutes', String(Math.round(courseMinutes))) : ''}
        </p>
      </div>
    </Link>
  );
}

const RING_RADIUS = 22;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function CompletionRing({ percent }: { percent: number }) {
  const { t } = useLanguage();
  const clamped = Math.max(0, Math.min(100, percent));
  const dashoffset = RING_CIRCUMFERENCE * (1 - clamped / 100);

  return (
    <svg className="dash-ring" viewBox="0 0 52 52" width="52" height="52" role="img" aria-label={t('dashboard.ring.aria', String(clamped))}>
      <circle className="dash-ring-track" cx="26" cy="26" r={RING_RADIUS} />
      <circle
        className="dash-ring-fill"
        cx="26"
        cy="26"
        r={RING_RADIUS}
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={dashoffset}
      />
      <text className="dash-ring-label" x="26" y="30" textAnchor="middle">
        {clamped}%
      </text>
    </svg>
  );
}

export default Dashboard;
