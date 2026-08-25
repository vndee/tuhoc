/**
 * ONE answer to "which courses does this reader have".
 *
 * ## Ruling S1-F31 — why this module exists at all
 *
 * `/` and `/library` both claim to list the reader's courses, and until this
 * module they computed that list by two different formulas:
 *
 *     Dashboard = GET /courses  ∪  GET /stats .courses  ∪  db.progress
 *     Library   = GET /courses  ∪  db.packages
 *
 * Measured, same session, seconds apart: the Dashboard showed a card reading
 * *"<tên khoá học> · 1/44 chương · 42 phút"* while `/library` showed zero
 * rows under the heading *"Thư viện của bạn đang trống"* and advised the reader
 * to import the course they were in the middle of reading. Neither screen was
 * lying about its own inputs; they simply disagreed about the question.
 *
 * The specific course that triggered it came from `course/loader.ts`'s SOURCE 2
 * — the static `courses/` directory, which ships in `dist/` — and Task 11
 * removes the one course that lives there, so that particular symptom is about
 * to disappear on its own. This module is not about that symptom. Source 2 is
 * still a supported source (`courseAssets.ts` still serves anything under
 * `courses/`, `docs/deploy.md` still treats it as a deploy asset), so the next
 * course dropped there rebuilds the same bug; and the structural defect — two
 * screens, two formulas, one question — outlives any particular course.
 *
 * This is the seventh time the project has taken a correct decision and framed
 * it too narrowly (progress.md's S1-F31 keeps the list). One-source-of-truth
 * had been applied to durable STORAGE and to the query cache. It had not been
 * applied to this QUESTION.
 *
 * ## The four sources, and why all four
 *
 *  1. `GET /courses` — the reader's library on the server. Authoritative, and
 *     a network call.
 *  2. `db.packages` — what this device actually holds and will actually open.
 *     Local, live-subscribed: a course imported in another tab shows up here
 *     without a reload.
 *  3. `db.progress` — a course this device has study rows for. Local, and the
 *     reason ruling F5's offline-first Dashboard works: a reader with no
 *     network still has courses.
 *  4. `GET /stats .courses` — a course studied on ANOTHER device. Nothing local
 *     knows about it, and it is still the reader's course.
 *
 * Dropping (3) and (4) is what emptied the library. Dropping (2) would make the
 * Dashboard blind to a package imported but not yet opened.
 *
 * ## What `settled` is for
 *
 * `courses` is whatever is known SO FAR and is never withheld — ruling F5 says
 * an offline reader must still see their courses, so a list gated on the network
 * would be a regression dressed as caution. `settled` is the separate question
 * "has every source answered", and it is the only thing a caller may use to
 * decide that an empty list means the reader has nothing. Rendering "your
 * library is empty" off `courses.length === 0` alone flashes that sentence at
 * every reader who has courses, which both screens had already learned
 * independently for their own single source.
 */

import { useQuery } from '@tanstack/react-query';
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { coursesQueryKey, type CourseSummary, listCourses } from '../api/courses';
import { fetchStats, statsQueryKey } from '../api/stats';
import { db } from '../db/local';
import { loadManifest, manifestQueryKey, pickPinned } from './loader';

/**
 * The fields a course list needs out of one row of `db.packages` — never the
 * row itself.
 *
 * `PackageRow` carries `files`, i.e. every chapter of the course, and the
 * mapping below happens INSIDE the `liveQuery` callback so those bytes are
 * garbage the moment it returns rather than parked in React state. Measured by
 * independent review at 20 packages / 24.1 MB: 27 ms to read, no long task, and
 * a heap that is flat across five visits — the cost is real and it is transient.
 */
export interface HeldPackage {
  readonly courseId: string;
  readonly version: string;
  readonly pinnedAt: string;
  readonly title: string | undefined;
  readonly lang: string | undefined;
  readonly tier: string | undefined;
  readonly registryId: string | undefined;
  /**
   * Hai trường dưới đây KHÔNG phải mở rộng phạm vi — chúng đã nằm sẵn trong
   * chính `row.manifest` mà hàm này đang đọc, và không đọc chúng là bắt màn
   * thư viện đi hỏi lại `loadManifest` để lấy thứ nó đang cầm trong tay.
   *
   * Hệ quả đo được trước khi thêm: một khoá ĐÃ ghim gói (tức đã có `title`)
   * không kích hoạt truy vấn manifest, nên hàng của nó là hàng DUY NHẤT trong
   * danh sách không có câu mô tả và không có thanh tiến độ — cao 104px cạnh
   * hai hàng 151px, vì một lý do người dùng không thể nhìn ra.
   */
  readonly description: string | undefined;
  /** Tổng số chương, đếm từ `manifest.parts` của chính gói đã ghim. */
  readonly chapters: number | undefined;
}

/** One course this reader has, and which of the four sources knew about it. */
export interface OwnedCourse {
  readonly courseId: string;
  /** The catalog entry, when `GET /courses` listed it. */
  readonly catalog: CourseSummary | undefined;
  /** The version this device holds and would open, when it holds one. */
  readonly held: HeldPackage | undefined;
  /** Local progress rows or `GET /stats` name this course. */
  readonly studied: boolean;
}

export interface OwnedCourses {
  /** Every course known so far. Never withheld while a source is in flight. */
  readonly courses: readonly OwnedCourse[];
  /** `true` once all four sources have answered — the ONLY basis for "you have none". */
  readonly settled: boolean;
  /** Whatever `GET /courses` failed with, for a caller that reports transport state. */
  readonly catalogError: unknown;
}

/**
 * Số chương trong một manifest, đọc phòng thủ.
 *
 * Cùng hạng với `manifestString`: `manifest` ở đây là `unknown` — nó đi ra từ
 * một tệp `.zip` mà người dùng nhập vào — nên mọi bước phải tự kiểm tra hình
 * dạng thay vì tin vào một kiểu đã khai.
 */
export function manifestChapterCount(manifest: unknown): number | undefined {
  if (typeof manifest !== 'object' || manifest === null) return undefined;
  const parts = (manifest as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return undefined;
  let total = 0;
  for (const part of parts) {
    const chapters = (part as { chapters?: unknown } | null)?.chapters;
    if (Array.isArray(chapters)) total += chapters.length;
  }
  return total;
}

export function manifestString(manifest: unknown, key: string): string | undefined {
  if (typeof manifest !== 'object' || manifest === null) return undefined;
  const value = (manifest as Record<string, unknown>)[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Every package this device holds, reduced to seven fields and live-subscribed.
 *
 * `null` means "not answered yet", and it is a distinct state from `[]` on
 * purpose: Dexie's first emission is asynchronous, so treating the initial value
 * as `[]` would report an empty device to every reader who has courses.
 */
function useHeldPackages(): HeldPackage[] | null {
  const [held, setHeld] = useState<HeldPackage[] | null>(null);

  useEffect(() => {
    const subscription = liveQuery(() =>
      db.packages.toArray().then((rows) =>
        rows.map(
          (row): HeldPackage => ({
            courseId: row.courseId,
            version: row.version,
            pinnedAt: row.pinnedAt,
            title: manifestString(row.manifest, 'title'),
            lang: manifestString(row.manifest, 'lang'),
            tier: manifestString(row.manifest, 'tier'),
            registryId: manifestString(row.manifest, 'registryId'),
            description: manifestString(row.manifest, 'description'),
            chapters: manifestChapterCount(row.manifest),
          }),
        ),
      ),
    ).subscribe({
      next: setHeld,
      error: (err) => {
        console.error('course/owned: local package query failed', err);
        // An unreadable local table must not hang a screen on "Đang tải…"
        // forever. The other three sources still have something to say.
        setHeld([]);
      },
    });
    return () => subscription.unsubscribe();
  }, []);

  return held;
}

/** Distinct course ids this device's progress table has ever written a row for. */
function useProgressCourseIds(): string[] | null {
  const [ids, setIds] = useState<string[] | null>(null);

  useEffect(() => {
    const subscription = liveQuery(() =>
      db.progress.toArray().then((rows) => Array.from(new Set(rows.map((r) => r.courseId)))),
    ).subscribe({
      next: setIds,
      error: (err) => {
        console.error('course/owned: local progress query failed', err);
        setIds([]);
      },
    });
    return () => subscription.unsubscribe();
  }, []);

  return ids;
}

/**
 * The union, as a pure function over the four sources — exported so it can be
 * tested without a React tree and without four fake transports.
 *
 * Sorted by course id: stable regardless of which source lands first, so a list
 * does not reshuffle when the catalog request arrives after the local query.
 * A caller that wants a reader-facing order (`/library` sorts by title) sorts
 * again on top.
 */
export function unionOwnedCourses(
  catalog: readonly CourseSummary[],
  held: readonly HeldPackage[],
  progressCourseIds: readonly string[],
  statsCourseIds: readonly string[],
): OwnedCourse[] {
  const byCourse = new Map<string, HeldPackage[]>();
  for (const pkg of held) {
    const list = byCourse.get(pkg.courseId);
    if (list === undefined) byCourse.set(pkg.courseId, [pkg]);
    else list.push(pkg);
  }

  const studied = new Set<string>([...progressCourseIds, ...statsCourseIds]);
  const ids = new Set<string>([
    ...catalog.map((entry) => entry.id),
    ...byCourse.keys(),
    ...studied,
  ]);

  const out: OwnedCourse[] = [];
  for (const courseId of ids) {
    const versions = byCourse.get(courseId);
    out.push({
      courseId,
      catalog: catalog.find((entry) => entry.id === courseId),
      // `pickPinned` and not a local rule that looks similar: the version this
      // says the reader holds must be the version `course/loader.ts` will open.
      held: versions !== undefined && versions.length > 0 ? pickPinned(versions) : undefined,
      studied: studied.has(courseId),
    });
  }
  return out.sort((a, b) => a.courseId.localeCompare(b.courseId));
}

export function useOwnedCourses(): OwnedCourses {
  const catalogQuery = useQuery({
    queryKey: coursesQueryKey(),
    queryFn: () => listCourses(),
    retry: false,
  });
  const statsQuery = useQuery({
    queryKey: statsQueryKey(),
    queryFn: () => fetchStats(),
    retry: false,
  });
  const held = useHeldPackages();
  const progressCourseIds = useProgressCourseIds();

  // No `useMemo`: these are small arrays, and rebuilding the union on every
  // render costs less than the hook that would avoid it.
  const courses = unionOwnedCourses(
    catalogQuery.data ?? [],
    held ?? [],
    progressCourseIds ?? [],
    // `?.` guards `data` being nullish, NOT `data.courses`. The type says
    // `courses` is required, so nothing here fails to compile — but a body
    // that arrives without it (see `NotJsonError` in api/client.ts) used to
    // throw during render and blank the page. `client.ts` now rejects that
    // body upstream; this stays as the second lock, because the type promise
    // and the wire are two different things.
    statsQuery.data?.courses?.map((c) => c.courseId) ?? [],
  );

  return {
    courses,
    settled: !catalogQuery.isPending && !statsQuery.isPending && held !== null && progressCourseIds !== null,
    catalogError: catalogQuery.isError ? catalogQuery.error : null,
  };
}

/**
 * Tên hiển thị của một khoá, cho những chỗ chỉ có `courseId` trong tay.
 *
 * `useOwnedCourses` biết tên của khoá mà máy này ĐANG GIỮ (`held`, đọc từ
 * `db.packages`) hoặc mà máy chủ có liệt kê (`catalog`). Nó KHÔNG biết tên của
 * một khoá được phục vụ TĨNH từ chính origin của app — `course/loader.ts` NGUỒN
 * 2, ruling S1-F31 — và với những khoá ấy màn hình in ra cái slug thô
 * ("bat-bien-vong-lap"). Một người học không đặt tên khoá của mình bằng dấu
 * gạch ngang; đó là địa chỉ, không phải tên.
 *
 * Nên khi và CHỈ KHI ba nguồn kia im lặng, hỏi manifest — cùng `manifestQueryKey`
 * mà thẻ "đang đọc", thanh bên và trang khoá học đã dùng, nên với khoá đang đọc
 * dở thì đây là một lần đọc cache chứ không phải một request thứ hai. Vẫn in
 * slug trong lúc chờ và khi hỏi không được: một cái tên đến chậm vẫn hơn một
 * chỗ trống, và một khoá thật sự không tra được thì slug là tất cả những gì có.
 *
 * Ở `course/owned.ts` chứ không ở màn hình đầu tiên cần nó: hai màn đã cần
 * (ghi chú gần đây ở `/`, danh sách khoá trong năm ở `/progress`), và hai bản
 * sao của cùng một chuỗi dự phòng bốn tầng là đúng chỗ trôi dạt.
 */
export function useCourseTitle(courseId: string, known: string | undefined): string {
  const manifestQuery = useQuery({
    queryKey: manifestQueryKey(courseId),
    queryFn: () => loadManifest(courseId),
    enabled: known === undefined && courseId !== '',
    retry: false,
  });
  return known ?? manifestString(manifestQuery.data, 'title') ?? courseId;
}
