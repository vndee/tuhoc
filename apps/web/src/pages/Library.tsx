import { useQuery } from '@tanstack/react-query';
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, serverAnswered } from '../api/client';
import { coursesQueryKey, type CourseSummary, listCourses } from '../api/courses';
import { pickPinned } from '../course/loader';
import { db } from '../db/local';

/* ------------------------------------------------------------------ *
 * What a library row is made of
 * ------------------------------------------------------------------ */

/**
 * Where a course came from — the third column of the library, and the one
 * that decides what may be offered for it.
 *
 *  - `registry` — the package carries a `registryId`, which only a registry
 *    stamps (packages/course-format's v2 `Manifest`; docs/course-format.md
 *    §2 says in as many words: do not fill it in yourself). Subsystem 3
 *    builds the registry; the FIELD exists today, so this lane is wired to
 *    something real instead of to a placeholder.
 *  - `private` — in this reader's library on the server (`GET /courses`)
 *    and not on any registry. Spec §2.4: private means no other user sees
 *    it.
 *  - `import` — held only on this device, brought in through `/import`
 *    (a `.zip`, a link to one, or a public GitHub repo).
 *
 * Two of the three are private in the ordinary sense of the word, and
 * neither of those two has anywhere to be shared TO: nothing outside the
 * registry publishes a course. That is why this page carries no share
 * control of any kind — see `CourseRow`.
 */
type CourseSource = 'registry' | 'private' | 'import';

const SOURCE_LABEL: Record<CourseSource, string> = {
  registry: 'registry',
  private: 'riêng tư',
  import: 'tự nhập',
};

interface LibraryRow {
  courseId: string;
  title: string;
  lang: string;
  /** `undefined` when nothing that named this course ever declared a tier — see `TierBadge`. */
  tier: string | undefined;
  /** The version that will actually open, not merely the one the server recommends. */
  version: string;
  source: CourseSource;
  heldLocally: boolean;
}

/** The fields the library needs out of one row of `db.packages`. */
interface HeldPackage {
  courseId: string;
  version: string;
  pinnedAt: string;
  title: string | undefined;
  lang: string | undefined;
  tier: string | undefined;
  registryId: string | undefined;
}

function manifestString(manifest: unknown, key: string): string | undefined {
  if (typeof manifest !== 'object' || manifest === null) return undefined;
  const value = (manifest as Record<string, unknown>)[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Every package this device holds, reduced to the seven fields above and
 * live-subscribed — the same shape and the same reasoning as the
 * Dashboard's `useLocalCourseIds`: a course imported in another tab, or on
 * this page while it is open, shows up without a reload.
 *
 * `null` means "not answered yet", and it is a distinct state from `[]` on
 * purpose. `[]` is what lets this page say the library is empty, which is
 * a claim; Dexie's first emission is asynchronous, so treating the initial
 * value as `[]` would flash "your library is empty" at every reader who has
 * courses. The Dashboard already learned this about `GET /courses`; the
 * local half has exactly the same failure.
 *
 * **What this read costs.** `toArray()` deserializes whole rows, and a
 * `PackageRow` carries its `files` — every chapter of the course. A reader
 * holding twenty 1.3 MB courses pays ~26 MB of structured-clone on every
 * visit to this page for seven strings per course. That is the honest
 * price of the current schema: `db.packages` indexes only `key` and
 * `courseId`, so there is no way to read a manifest field without reading
 * the package around it. The fix, if this ever bites, is a Dexie version 3
 * that stores `title`/`lang`/`tier`/`registryId` as their own columns — a
 * schema migration, which is a decision for whoever owns that table, not
 * something to smuggle in here. The mapping below is done INSIDE the
 * liveQuery callback so the heavy rows are garbage the moment it returns
 * rather than being parked in React state.
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
          }),
        ),
      ),
    ).subscribe({
      next: setHeld,
      error: (err) => {
        console.error('Library: local package query failed', err);
        // An unreadable local table is not a reason to hang on "Đang tải…"
        // forever: the server half of this page still has something to
        // show, and an empty local list is the truthful thing to render
        // for a database that will not open.
        setHeld([]);
      },
    });
    return () => subscription.unsubscribe();
  }, []);

  return held;
}

/**
 * One row per course the reader has, from BOTH sources, de-duplicated by
 * course id.
 *
 * **The local copy wins every field it can answer, and that is not a
 * preference — it is what `course/loader.ts` does.** That module reads the
 * cached package before it reads anything else and never falls back once it
 * hits ("the cached package answers for its course completely"). So the
 * title, language, tier and version a reader will actually meet when they
 * open the course are the LOCAL ones. Printing the server's `pinned` beside
 * a course whose device copy is a different version would be a lie that
 * looks like a fact.
 *
 * Sorted by title so the list does not reshuffle when the catalog request
 * lands after the local query, or the other way round.
 */
function buildRows(catalog: readonly CourseSummary[], held: readonly HeldPackage[]): LibraryRow[] {
  const byId = new Map<string, LibraryRow>();

  for (const entry of catalog) {
    byId.set(entry.id, {
      courseId: entry.id,
      title: entry.title,
      lang: entry.lang,
      tier: entry.tier === '' ? undefined : entry.tier,
      version: entry.pinned,
      source: 'private',
      heldLocally: false,
    });
  }

  const byCourse = new Map<string, HeldPackage[]>();
  for (const pkg of held) {
    const list = byCourse.get(pkg.courseId);
    if (list === undefined) byCourse.set(pkg.courseId, [pkg]);
    else list.push(pkg);
  }

  for (const [courseId, versions] of byCourse) {
    // The same `pickPinned` `loadManifest` uses, so the version printed here
    // is the version that opens.
    const pinned = pickPinned(versions);
    const fromServer = byId.get(courseId);
    byId.set(courseId, {
      courseId,
      title: pinned.title ?? fromServer?.title ?? courseId,
      lang: pinned.lang ?? fromServer?.lang ?? '—',
      tier: pinned.tier ?? fromServer?.tier,
      version: pinned.version,
      source: pinned.registryId !== undefined ? 'registry' : fromServer !== undefined ? 'private' : 'import',
      heldLocally: true,
    });
  }

  return Array.from(byId.values()).sort((a, b) => a.title.localeCompare(b.title, 'vi'));
}

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */

/**
 * `/library` — every course this reader has, from the server library and
 * from this device, in one list: title, language, tier, source, and the
 * pinned version.
 *
 * Three things on this screen are load-bearing rather than decorative, and
 * each has its own test:
 *
 *  1. **The `interactive` tier label** (§1.2). That tier is a SECURITY
 *     classification, not a content genre: an `interactive` package ships
 *     JavaScript that runs in the reader's browser, on this origin, and the
 *     guarantee for it comes from human review at a registry — which, for a
 *     package that never went near a registry, means from nobody. §1.2's
 *     own table says the label is shown to whoever pulls the course. See
 *     `TierBadge`.
 *  2. **The offline indicator** (ruling S1-F25). See `TransportNotice`.
 *  3. **No share control anywhere.** See `CourseSource` and `CourseRow`.
 *
 * This page makes exactly ONE network request (`GET /courses`) and reads
 * one local table. It deliberately does not fetch a manifest per course the
 * way the Dashboard's cards do: everything it prints is already in the
 * catalog response or in the stored package, and a library that could not
 * be listed without N round trips would be useless in precisely the
 * situation this page exists to describe.
 */
export function Library() {
  const coursesQuery = useQuery({
    queryKey: coursesQueryKey(),
    queryFn: () => listCourses(),
    retry: false,
  });
  const held = useHeldPackages();

  // "Do not know yet" — never rendered as "there is nothing".
  const settling = coursesQuery.isPending || held === null;
  const rows = settling ? [] : buildRows(coursesQuery.data ?? [], held ?? []);

  return (
    <div className="lib-page">
      <div className="lib-header">
        <div>
          <h1 className="ch-title">Thư viện</h1>
          <p className="ch-lede">Mọi khóa học bạn đang có — trên máy chủ và trên thiết bị này.</p>
        </div>
        <Link to="/import" className="btn">
          Nhập khóa học
        </Link>
      </div>

      <TransportNotice error={coursesQuery.isError ? coursesQuery.error : null} />

      {settling && <p className="lib-note">Đang tải thư viện…</p>}

      {!settling && rows.length === 0 && (
        <EmptyLibrary
          heading={coursesQuery.isError ? 'Chưa có khóa học nào trên thiết bị này' : 'Thư viện của bạn đang trống'}
        />
      )}

      {rows.length > 0 && (
        <ul className="lib-list" aria-label="Khóa học của bạn">
          {rows.map((row) => (
            <CourseRow key={row.courseId} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What went wrong reaching `GET /courses`, said in a way that distinguishes
 * the two cases a browser refuses to distinguish for us.
 *
 * **Ruling S1-F25, which this exists to close.** Task 7b measured that a
 * CORS refusal in production is indistinguishable from a dead network at
 * the client: both arrive as a bare `TypeError` with no status and no body
 * (see `serverAnswered`'s own doc comment for the four cases). The
 * consequence is not a cosmetic one — a MISCONFIGURED DEPLOY looks exactly
 * like "this reader's wifi is bad", to the reader and to whoever operates
 * the server, so nobody ever finds out. Task 7b deliberately left this
 * alone rather than ship untested UI; it is tested here, in both
 * directions.
 *
 * So there are three renders, not two:
 *
 *  - no error → nothing. An indicator that is always on says nothing.
 *  - the server ANSWERED (any status) → say the status. A reachable, broken
 *    server is not an offline device, and calling it one is the same
 *    mistake in the other direction: it would hide a 500 behind "chắc mạng
 *    bạn yếu".
 *  - NO answer arrived → say that the page is showing the copy on this
 *    device, and name BOTH readings of the silence. Naming only the
 *    ngoại-tuyến one is what makes the misconfiguration invisible.
 *
 * The whole sentence is one text node on purpose: a `<strong>` around the
 * first clause would split it, and the test that pins the wording reads the
 * element's own text.
 */
function TransportNotice({ error }: { error: unknown }) {
  if (error === null || error === undefined) return null;

  if (serverAnswered(error)) {
    // `serverAnswered` is the single place that decides "did a response ever
    // arrive"; the narrowing below only reads the status off the error it has
    // already vouched for, and is written as a fallback rather than a cast so
    // a future widening of that predicate cannot turn into a crash here.
    const status = error instanceof ApiError ? error.status : 0;
    return (
      <p className="lib-notice lib-notice-server" role="status">
        {`Máy chủ có trả lời, nhưng báo lỗi (HTTP ${status}), nên thư viện trên máy chủ chưa tải được. Những khóa học đã lưu trên thiết bị này vẫn hiện ở dưới.`}
      </p>
    );
  }

  return (
    <p className="lib-notice lib-notice-offline" role="status">
      {'Đang đọc bản lưu trên máy — máy chủ không trả lời một lần nào. Có thể bạn đang ngoại tuyến, hoặc máy chủ đang bị cấu hình sai (CORS/DNS): trình duyệt trả về đúng một lỗi trống cho cả hai, nên trang này không phân biệt được. Chỉ những khóa học đã lưu trên thiết bị này mới hiện ở dưới.'}
    </p>
  );
}

/**
 * One course. A title that opens it, a tier badge, and a metadata line —
 * and nothing else.
 *
 * **There is no share control here, and its absence is the feature.** Spec
 * §2.4 draws private's boundary as "no other user sees it"; the only thing
 * on this screen that could undo that with one click is a share button, and
 * two of the three sources (`private`, `import`) have nowhere to share TO
 * in the first place. When the registry lands (subsystem 3) and publishing
 * becomes a real operation, it needs its own screen with its own
 * confirmation — not a button sitting one mis-click away from a course
 * somebody put here precisely because it was theirs.
 */
function CourseRow({ row }: { row: LibraryRow }) {
  return (
    <li className={`lib-item lib-item-${row.source}`}>
      <div className="lib-item-head">
        <Link to={`/c/${row.courseId}`} className="lib-item-title">
          {row.title}
        </Link>
        <TierBadge tier={row.tier} />
      </div>
      <p className="lib-meta">
        <span className="lib-meta-part">{row.lang}</span>
        <span className="lib-meta-sep" aria-hidden="true">
          ·
        </span>
        <span className="lib-meta-part">phiên bản {row.version}</span>
        <span className="lib-meta-sep" aria-hidden="true">
          ·
        </span>
        <span className={`lib-source lib-source-${row.source}`}>{SOURCE_LABEL[row.source]}</span>
        {row.heldLocally && (
          <>
            <span className="lib-meta-sep" aria-hidden="true">
              ·
            </span>
            <span className="lib-meta-part">đã tải về máy</span>
          </>
        )}
      </p>
    </li>
  );
}

/**
 * The tier, and for one of the two values a warning rather than a label.
 *
 * `content` gets a quiet badge: §1.2's table says the catalog shows no
 * label for it, and a badge that appears on everything trains a reader to
 * stop reading badges. `interactive` gets a loud one that says what the
 * word means — "chạy mã JavaScript" — because "interactive" on its own
 * reads as a promise about the content ("has simulations!"), which is the
 * opposite of the thing being communicated.
 *
 * **An unknown tier is warned about, not waved through.** A manifest with
 * no `tier` never passed the server's `CHECK (tier IN ('content',
 * 'interactive'))` or course-format's validator, so it arrived by some
 * route neither of those covered. Reading a missing field as `content`
 * would turn "we do not know what this ships" into a silent all-clear,
 * which is the wrong direction to fail on a security label.
 */
function TierBadge({ tier }: { tier: string | undefined }) {
  if (tier === 'content') {
    return (
      <span className="lib-tier lib-tier-content" title="Hạng content: chỉ HTML, CSS, hình ảnh và công thức toán — không có JavaScript.">
        content
      </span>
    );
  }
  if (tier === 'interactive') {
    return (
      <span
        className="lib-tier lib-tier-code"
        title="Hạng interactive (§1.2): khóa học này được phép chứa JavaScript, và mã đó chạy trong trình duyệt của bạn khi bạn đọc."
      >
        interactive — chạy mã JavaScript
      </span>
    );
  }
  return (
    <span
      className="lib-tier lib-tier-code"
      title="Gói này không khai báo hạng, nên không có gì bảo đảm nó không chứa JavaScript."
    >
      hạng không rõ — có thể chạy mã
    </span>
  );
}

/**
 * The screen a brand-new account actually lands on, and the reason it is
 * written as a road rather than as an apology.
 *
 * Task 6 deleted the Dashboard's hardcoded `KNOWN_COURSE_IDS`, so a new
 * reader's library is genuinely empty — spec §9.5 chose that: shipping a
 * seeded course would make a BROKEN IMPORT PATH invisible, because the app
 * would look fine to everybody who never imported anything. The cost of
 * that choice is that this state is the front door, and a front door that
 * only says "trống" is where the platform dies at step one.
 *
 * So: it says why it is empty (that is a decision, not a fault), it hands
 * over the one action that changes it, and it names the three ways in so
 * the reader knows before they click that a file on their own disk is
 * enough. The registry's place is held by a sentence and deliberately NOT
 * by a link — subsystem 3 has not built it, and a button that goes nowhere
 * is worse than an honest "not yet".
 *
 * Exported because the Dashboard renders the identical state for the
 * identical reason (`courseIds.length === 0`), and the alternative is two
 * copies of the front door drifting apart.
 */
export function EmptyLibrary({ heading = 'Thư viện của bạn đang trống' }: { heading?: string }) {
  return (
    <div className="lib-empty">
      <h2 className="lib-empty-h">{heading}</h2>
      <p className="lib-empty-lede">
        Bạn chưa có khóa học nào. tuhoc cố ý không đóng gói sẵn khóa học nào — bạn tự chọn thứ mình đọc, và cách duy
        nhất để bắt đầu là nhập một gói.
      </p>
      <Link to="/import" className="btn primary lib-empty-cta">
        Nhập khóa học
      </Link>
      <ul className="lib-empty-ways">
        <li>
          một tệp <code>.zip</code> có sẵn trên máy bạn — cách này chạy được cả khi mất mạng
        </li>
        <li>
          một đường dẫn tới tệp <code>.zip</code>
        </li>
        <li>một repo GitHub công khai</li>
      </ul>
      <p className="lib-empty-registry">
        Kho khóa học cộng đồng (registry) đang được xây dựng — khi có, nó sẽ hiện ngay ở đây.
      </p>
    </div>
  );
}

export default Library;
