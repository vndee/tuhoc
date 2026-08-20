import { useQuery } from '@tanstack/react-query';
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLogout } from '../auth/useLogout';
import { api } from '../api/client';
import { useMe } from '../api/useMe';
import { describeCourseError, loadManifest, manifestQueryKey } from '../course/loader';
import type { Manifest } from '../course/types';
import { db } from '../db/local';
import { useProgress } from '../progress/useProgress';

/**
 * Every course this app ships in `courses/` today. The full platform spec
 * (docs/superpowers/specs/2026-08-19-tuhoc-platform-design.md §4) lists a
 * `GET /courses` registry endpoint ("registry + trạng thái enroll"), but
 * no task through this one has built it (see `.superpowers/sdd/
 * 2026-08-19-p1-platform-core/progress.md`'s own ledger, which names it
 * as P4 territory). Until a real catalog exists, this is the Dashboard's
 * fallback answer to "which courses might this learner care about" —
 * unioned with whatever `GET /stats` and local progress ALREADY know
 * about (see `useDashboardCourseIds` below), so a brand-new, offline,
 * never-touched-anything learner still has an entry point into the one
 * course this platform actually has, and a real catalog slotting in
 * later only needs this constant deleted, not a redesign.
 */
const KNOWN_COURSE_IDS = ['***REMOVED***'];

interface DayStat {
  date: string;
  minutes: number;
}

interface CourseStat {
  courseId: string;
  minutes: number;
  chaptersDone: number;
}

/** `GET /stats`'s response shape — apps/api/internal/stats/handler.go's `statsResponse`. */
interface Stats {
  totalMinutes: number;
  streakDays: number;
  days: DayStat[];
  courses: CourseStat[];
}

function statsQueryKey() {
  return ['stats'] as const;
}

function useStats() {
  return useQuery({
    queryKey: statsQueryKey(),
    queryFn: () => api.get<Stats>('/stats'),
    retry: false,
  });
}

/**
 * Distinct `courseId`s this browser's LOCAL progress table has ever
 * written a row for — live-subscribed the same way `useProgress` is (see
 * that hook's own doc comment on why a plain `toArray()` + JS filter is
 * the right call here rather than a dedicated Dexie index), so this list
 * updates the moment a chapter is marked read in a course that wasn't
 * previously known, without a page reload.
 */
function useLocalCourseIds(): string[] {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    const subscription = liveQuery(() =>
      db.progress.toArray().then((rows) => Array.from(new Set(rows.map((r) => r.courseId)))),
    ).subscribe({
      next: setIds,
      error: (err) => console.error('Dashboard: local course id query failed', err),
    });
    return () => subscription.unsubscribe();
  }, []);

  return ids;
}

/**
 * The set of courses the Dashboard renders a card for: the known-course
 * fallback above, UNION every `courseId` `GET /stats` mentions, UNION
 * every `courseId` local progress has a row for. Deliberately a union of
 * three sources, not just `/stats` alone — Ruling F5 requires the
 * completion ring to stay correct offline, and a Dashboard that only
 * learns which courses exist from a network call would show NO cards at
 * all while offline for a learner whose local progress already proves
 * they have a course open. `useMemo` is skipped here on purpose: these
 * are tiny arrays (this platform ships one course today) and rebuilding
 * the de-duplicated union on every render is not worth the extra hook.
 */
function useDashboardCourseIds(statsCourses: CourseStat[] | undefined): string[] {
  const localCourseIds = useLocalCourseIds();
  const statsCourseIds = statsCourses?.map((c) => c.courseId) ?? [];
  return Array.from(new Set([...KNOWN_COURSE_IDS, ...statsCourseIds, ...localCourseIds])).sort();
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
  const meQuery = useMe();
  const logout = useLogout();
  const statsQuery = useStats();
  const courseIds = useDashboardCourseIds(statsQuery.data?.courses);

  return (
    <div className="dashboard">
      <div className="dash-header">
        <div>
          <h1 className="ch-title">Bảng điều khiển</h1>
          <p className="ch-lede">Tiến độ học tập và thời gian học của bạn.</p>
        </div>
        <div className="dash-user">
          {meQuery.data && <span className="dash-user-name">{meQuery.data.name}</span>}
          <button type="button" className="btn" onClick={() => void logout()}>
            Đăng xuất
          </button>
        </div>
      </div>

      <StatsSummary statsQuery={statsQuery} />

      <div className="dash-cards">
        {courseIds.map((courseId) => (
          <CourseCard key={courseId} courseId={courseId} statsCourses={statsQuery.data?.courses} />
        ))}
      </div>
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
  if (statsQuery.isPending) {
    return <p className="dash-stats-note">Đang tải số liệu học tập…</p>;
  }

  if (statsQuery.isError) {
    return (
      <p className="dash-stats-note">
        Không tải được số liệu học tập (có thể bạn đang ngoại tuyến). Phần trăm hoàn thành mỗi khóa học ở dưới vẫn
        chính xác — dữ liệu đó được lưu ngay trên máy bạn.
      </p>
    );
  }

  const stats = statsQuery.data;
  return (
    <>
      <div className="dash-summary">
        <div className="dash-stat">
          <span className="dash-stat-v">{stats.streakDays}</span>
          <span className="dash-stat-k">ngày liên tục</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-v">{Math.round(stats.totalMinutes)}</span>
          <span className="dash-stat-k">phút đã học</span>
        </div>
      </div>
      <DayChart days={stats.days} />
    </>
  );
}

function DayChart({ days }: { days: DayStat[] }) {
  const maxMinutes = Math.max(1, ...days.map((d) => d.minutes));
  return (
    <div className="dash-chart" aria-label="Số phút học trong 30 ngày gần nhất">
      {days.map((d) => {
        const heightPct = d.minutes > 0 ? Math.max(4, (d.minutes / maxMinutes) * 100) : 0;
        return (
          <div key={d.date} className="dash-bar" title={`${d.date}: ${Math.round(d.minutes)} phút`}>
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
  const manifestQuery = useQuery({
    queryKey: manifestQueryKey(courseId),
    queryFn: () => loadManifest(courseId),
  });
  const { partStats } = useProgress(courseId);

  if (manifestQuery.isPending) {
    return <div className="dash-card dash-card-pending">Đang tải…</div>;
  }
  if (manifestQuery.isError) {
    return <div className="dash-card dash-card-error">{describeCourseError(manifestQuery.error)}</div>;
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
          {partStats.chaptersRead}/{totalChapters} chương đã học
          {courseMinutes != null ? ` · ${Math.round(courseMinutes)} phút` : ''}
        </p>
      </div>
    </Link>
  );
}

const RING_RADIUS = 22;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function CompletionRing({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const dashoffset = RING_CIRCUMFERENCE * (1 - clamped / 100);

  return (
    <svg className="dash-ring" viewBox="0 0 52 52" width="52" height="52" role="img" aria-label={`${clamped}% hoàn thành`}>
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
