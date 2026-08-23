import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, serverAnswered } from '../api/client';
import { describeCourseError, loadManifest, manifestQueryKey } from '../course/loader';
import { manifestString, type OwnedCourse, useOwnedCourses } from '../course/owned';
import { UpdateDialog } from '../course/UpdateDialog';
import type { MessageKey } from '../i18n';
import { useLanguage } from '../i18n/LanguageProvider';

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
 *  - `unknown` — the reader has study rows for it (locally, or on another
 *    device via `GET /stats`) and neither the catalog nor this device's
 *    package table can say where it came from. `course/loader.ts`'s SOURCE 2,
 *    the static `courses/` directory, lands here. Before ruling S1-F31 this
 *    case had no row at all: the library said the reader had nothing while
 *    the Dashboard was showing them a card for it.
 *
 * Three of the four are private in the ordinary sense of the word, and none
 * of those three has anywhere to be shared TO: nothing outside the registry
 * publishes a course. That is why this page carries no share control of any
 * kind — see `CourseRow`.
 */
type CourseSource = 'registry' | 'private' | 'import' | 'unknown';

/**
 * Nhãn nguồn → KHOÁ, không phải chữ. Bảng này là hằng số ở tầm module, tức
 * là nó được dựng MỘT LẦN lúc nạp — trước khi có ngôn ngữ nào được chọn —
 * nên nó không được phép chứa chữ đã dịch. `MessageKey` làm `tsc` kiểm được
 * rằng cả bốn khoá tồn tại thật.
 */
const SOURCE_LABEL_KEY: Record<CourseSource, MessageKey> = {
  registry: 'library.source.registry',
  private: 'library.source.private',
  import: 'library.source.import',
  unknown: 'library.source.unknown',
};

interface LibraryRow {
  courseId: string;
  /** `undefined` when only a study row named this course — `CourseRow` then asks the loader. */
  title: string | undefined;
  lang: string | undefined;
  /** `undefined` when nothing that named this course ever declared a tier — see `TierBadge`. */
  tier: string | undefined;
  /** The version that will actually open, not merely the one the server recommends. */
  version: string | undefined;
  source: CourseSource;
  heldLocally: boolean;
  /** The newer version the server offers for a course this device holds, if any. */
  updateTo: string | undefined;
}

/**
 * One `OwnedCourse` as a row.
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
 * **`tier` does NOT fall back to the server (ruling S1-F30's minor sibling).**
 * Every other field falls back, because a wrong `lang` is a cosmetic defect.
 * A tier is a security decision — `interactive` means this course is allowed
 * to run JavaScript in the reader's browser — and the two claims are about
 * two DIFFERENT artifacts: the server describes the package IT holds, and the
 * package that opens is the one on this device. A held package with no tier
 * inheriting a catalog entry's `content` is a silent all-clear issued about
 * something nobody examined. Unknown stays unknown, and `TierBadge` warns.
 */
function toRow(course: OwnedCourse): LibraryRow {
  const { held, catalog } = course;
  const source: CourseSource =
    held?.registryId !== undefined
      ? 'registry'
      : catalog !== undefined
        ? 'private'
        : held !== undefined
          ? 'import'
          : 'unknown';

  const version = held?.version ?? (catalog?.pinned === '' ? undefined : catalog?.pinned);
  // Only offered for a course this device HOLDS: for one it does not hold,
  // `catalog.pinned` is not an update, it is simply the version that would be
  // downloaded on first open.
  const updateTo =
    held !== undefined && catalog !== undefined && catalog.pinned !== '' && catalog.pinned !== held.version
      ? catalog.pinned
      : undefined;

  return {
    courseId: course.courseId,
    title: held?.title ?? catalog?.title,
    lang: held?.lang ?? catalog?.lang,
    tier: held !== undefined ? held.tier : catalog?.tier === '' ? undefined : catalog?.tier,
    version,
    source,
    heldLocally: held !== undefined,
    updateTo,
  };
}

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */

/**
 * `/library` — every course this reader has, in one list: title, language,
 * tier, source, and the pinned version.
 *
 * **"Every course this reader has" is not this file's opinion** (ruling
 * S1-F31). It is `course/owned.ts`, which the Dashboard asks the same
 * question. This page used to compute its own answer from two sources while
 * the Dashboard computed a different one from three, and the two disagreed on
 * screen, in the same session, seconds apart — a reader partway through a
 * course was shown a card for it on `/` and told "thư viện của bạn đang trống"
 * here. This file now decides how a course is DISPLAYED and nothing about
 * which courses exist.
 *
 * Four things on this screen are load-bearing rather than decorative, and
 * each has its own test:
 *
 *  1. **The `interactive` tier label** (§1.2). That tier is a SECURITY
 *     classification, not a content genre: an `interactive` package ships
 *     JavaScript that runs in the reader's browser, on this origin, and the
 *     guarantee for it comes from human review at a registry — which, for a
 *     package that never went near a registry, means from nobody. §1.2's
 *     own table says the label is shown to whoever pulls the course. See
 *     `TierBadge`, and `toRow` for why this one field never falls back.
 *  2. **The offline indicator** (ruling S1-F25). See `TransportNotice`.
 *  3. **No share control anywhere.** See `CourseSource` and `CourseRow`.
 *  4. **The door into `UpdateDialog`** (ruling S1-F29). Task 10 shipped 775
 *     lines of update machinery that no product file imported, past four
 *     green gates, because no gate this project has can ask whether a reader
 *     can reach a thing. See `CourseRow`.
 *
 * **What this page costs.** Two network requests (`GET /courses` and
 * `GET /stats`, both shared by query key with the Dashboard, so arriving from
 * `/` costs neither again) plus two local tables, and then ONE manifest lookup
 * for each course that no source could name. That last clause is new with
 * ruling S1-F31 and it is a deliberate trade: the page used to make exactly one
 * request and, in exchange, could not list a course the reader was in the
 * middle of reading. A library that omits your courses to save a round trip has
 * saved the wrong thing. The lookups are per-course-with-no-metadata only —
 * usually zero — and share `manifestQueryKey` with the Dashboard's cards, so
 * they are typically a cache hit rather than a request.
 */
export function Library() {
  const { lang, t } = useLanguage();
  const owned = useOwnedCourses();
  // Thứ tự chữ cái theo NGÔN NGỮ ĐANG HIỂN THỊ, không cố định 'vi': tiếng
  // Việt sắp `Đ` sau `D` còn tiếng Anh thì không, nên một danh sách sắp bằng
  // luật của ngôn ngữ khác đọc như một danh sách không sắp.
  const rows = owned.courses.map(toRow).sort((a, b) => (a.title ?? a.courseId).localeCompare(b.title ?? b.courseId, lang));

  return (
    <div className="lib-page">
      {/*
        KHÔNG có phần đầu trang ở đây nữa, và đó là một sự chuyển giao chứ không
        phải một mất mát: `pages/Courses.tsx` mang nhan đề, câu dẫn và nút "Nhập
        gói" cho CẢ HAI tab. Giữ lại một `h1` "Thư viện" ở đây sẽ là `h1` thứ
        hai trên cùng một trang, ngay dưới `h1` "Khoá học" — và một tiêu đề nói
        rằng bạn đang ở "Thư viện" trong khi thanh bên đã đánh dấu "Khoá học" là
        đúng loại bất đồng mà bản thiết kế lại này sinh ra để gỡ.
      */}
      <TransportNotice error={owned.catalogError} />

      {/* "Do not know yet" — never rendered as "there is nothing". */}
      {!owned.settled && rows.length === 0 && <p className="lib-note">{t('library.loading')}</p>}

      {owned.settled && rows.length === 0 && (
        <EmptyLibrary
          heading={t(owned.catalogError ? 'library.empty.headingOffline' : 'library.empty.heading')}
        />
      )}

      {rows.length > 0 && (
        <ul className="lib-list" aria-label={t('library.list.aria')}>
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
  const { t } = useLanguage();
  if (error === null || error === undefined) return null;

  if (serverAnswered(error)) {
    // `serverAnswered` is the single place that decides "did a response ever
    // arrive"; the narrowing below only reads the status off the error it has
    // already vouched for, and is written as a fallback rather than a cast so
    // a future widening of that predicate cannot turn into a crash here.
    const status = error instanceof ApiError ? error.status : 0;
    return (
      <p className="lib-notice lib-notice-server" role="status">
        {t('library.notice.server', String(status))}
      </p>
    );
  }

  return (
    <p className="lib-notice lib-notice-offline" role="status">
      {t('library.notice.offline')}
    </p>
  );
}

/**
 * One course. A title that opens it, a tier badge, a metadata line, and — for
 * a held course the server has moved past — the door to `UpdateDialog`.
 *
 * **There is no share control here, and its absence is the feature.** Spec
 * §2.4 draws private's boundary as "no other user sees it"; the only thing
 * on this screen that could undo that with one click is a share button, and
 * three of the four sources (`private`, `import`, `unknown`) have nowhere to
 * share TO in the first place. When the registry lands (subsystem 3) and
 * publishing becomes a real operation, it needs its own screen with its own
 * confirmation — not a button sitting one mis-click away from a course
 * somebody put here precisely because it was theirs.
 *
 * **The manifest lookup, and when it happens.** A row built only from a study
 * record has no title, no language and no version — nothing named it except
 * the fact that the reader has been reading it. Rather than print a course id
 * at somebody, this asks `loadManifest`, which is the same call (and the same
 * query key) the Dashboard's card for that course already makes, so on the
 * ordinary path it is a cache read. `enabled` keeps it off entirely for the
 * rows that need nothing.
 */
function CourseRow({ row }: { row: LibraryRow }) {
  const { t } = useLanguage();
  const needsManifest = row.title === undefined;
  const manifestQuery = useQuery({
    queryKey: manifestQueryKey(row.courseId),
    queryFn: () => loadManifest(row.courseId),
    enabled: needsManifest,
    retry: false,
  });
  const [updating, setUpdating] = useState(false);

  const manifest: unknown = manifestQuery.data;
  const title = row.title ?? manifestString(manifest, 'title') ?? row.courseId;
  const lang = row.lang ?? manifestString(manifest, 'lang') ?? '—';
  const version = row.version ?? manifestString(manifest, 'version') ?? '—';
  const tier = row.tier ?? manifestString(manifest, 'tier');

  return (
    <li className={`lib-item lib-item-${row.source}`}>
      <div className="lib-item-head">
        <Link to={`/c/${row.courseId}`} className="lib-item-title">
          {title}
        </Link>
        <TierBadge tier={tier} />
      </div>
      <p className="lib-meta">
        <span className="lib-meta-part">{lang}</span>
        <span className="lib-meta-sep" aria-hidden="true">
          ·
        </span>
        <span className="lib-meta-part">{t('library.meta.version', version)}</span>
        <span className="lib-meta-sep" aria-hidden="true">
          ·
        </span>
        <span className={`lib-source lib-source-${row.source}`}>{t(SOURCE_LABEL_KEY[row.source])}</span>
        {row.heldLocally && (
          <>
            <span className="lib-meta-sep" aria-hidden="true">
              ·
            </span>
            <span className="lib-meta-part">{t('library.meta.held')}</span>
          </>
        )}
      </p>

      {needsManifest && manifestQuery.isError && (
        <p className="lib-row-note">{describeCourseError(manifestQuery.error, t)}</p>
      )}

      {/*
        Ruling S1-F29 closed here. `UpdateDialog` + `course/version.ts` shipped
        as 775 lines that NO product file imported — four green gates and not
        one of them can ask "can a reader reach this". This is the door: a
        course this device holds, where the server's pinned version is not the
        one held. The dialog is a dry run until its confirm button, so opening
        it is free (see `course/version.ts`'s rule 1), which is why this is a
        plain button and not a guarded one.
      */}
      {row.updateTo !== undefined && row.version !== undefined && (
        <div className="lib-item-update">
          <span className="lib-update-note">{t('library.update.available', row.updateTo)}</span>
          <button type="button" className="btn lib-update-btn" onClick={() => setUpdating(true)}>
            {t('library.update.view')}
          </button>
        </div>
      )}

      {updating && row.updateTo !== undefined && row.version !== undefined && (
        <UpdateDialog
          courseId={row.courseId}
          courseTitle={title}
          fromVersion={row.version}
          toVersion={row.updateTo}
          onClose={() => setUpdating(false)}
        />
      )}
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
  const { t } = useLanguage();

  if (tier === 'content') {
    return (
      <span className="lib-tier lib-tier-content" title={t('library.tier.contentTitle')}>
        content
      </span>
    );
  }
  if (tier === 'interactive') {
    return (
      <span className="lib-tier lib-tier-code" title={t('library.tier.interactiveTitle')}>
        <WarnMark />
        {t('library.tier.interactiveLabel')}
      </span>
    );
  }
  return (
    <span className="lib-tier lib-tier-code" title={t('library.tier.unknownTitle')}>
      <WarnMark />
      {t('library.tier.unknownLabel')}
    </span>
  );
}

/**
 * Tam giác cảnh báo đứng trước nhãn hạng chạy-mã.
 *
 * Hướng A của đặc tả bỏ "viên màu đỏ" và thay bằng **một dòng chữ kèm biểu
 * tượng cảnh báo**: một viên màu bắt người đọc học nghĩa của một màu trước khi
 * nó nói được điều gì, còn một dòng chữ thì tự nói. Biểu tượng ở đây không
 * MANG thông tin — nguyên câu vẫn nằm trong chữ bên cạnh, và `title` nói dài
 * hơn nữa — nên nó `aria-hidden`: đọc "hình tam giác" trước mỗi hàng chỉ làm
 * dài thêm cái mà người dùng trình đọc màn hình đã nghe đủ.
 *
 * Vì sao vẽ tay chứ không dùng ký tự `⚠`: ký tự ấy được font hệ thống vẽ, nên
 * nó đổi hình dạng và đổi cả màu (nhiều font vẽ nó bằng emoji nhiều màu) theo
 * từng máy — với một nhãn AN NINH thì "trông thế nào" không nên do máy người
 * đọc quyết định.
 */
function WarnMark() {
  return (
    <svg className="lib-tier-mark" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        d="M8 1.8 15 14H1L8 1.8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M8 6.2v3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.7" r="0.85" fill="currentColor" />
    </svg>
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
/**
 * `heading` mặc định là `undefined`, KHÔNG phải một chuỗi mặc định: một giá
 * trị mặc định viết thẳng vào chữ ký hàm là một chuỗi cứng dựng lúc nạp
 * module, tức trước khi có ngôn ngữ nào. Chỗ vẽ tự lùi về khoá.
 */
export function EmptyLibrary({ heading }: { heading?: string }) {
  const { t, tNode } = useLanguage();

  return (
    <div className="lib-empty">
      <h2 className="lib-empty-h">{heading ?? t('library.empty.heading')}</h2>
      <p className="lib-empty-lede">{t('library.emptyState.lede')}</p>
      {/*
        Trỏ thẳng vào `/courses?import=1`, KHÔNG vào `/import`.
        `/import` vẫn sống và vẫn chuyển hướng về đúng đây (xem `routes.tsx`),
        nhưng đó là lối cho những liên kết đã nằm sẵn ngoài kia — không phải
        thứ mã trong nhà nên tự đi vòng qua. Bảng điều khiển dựng chính khối
        này khi thư viện rỗng, nên cú bấm ấy mở luôn hộp thoại nhập gói thay vì
        thả người đọc xuống một danh sách trống lần thứ hai.
      */}
      <Link to="/courses?import=1" className="btn primary lib-empty-cta">
        {t('courses.import.action')}
      </Link>
      <ul className="lib-empty-ways">
        <li>{tNode('library.emptyState.wayFile', <code>.zip</code>)}</li>
        <li>{tNode('library.emptyState.wayUrl', <code>.zip</code>)}</li>
        <li>{t('library.emptyState.wayRepo')}</li>
      </ul>
      <p className="lib-empty-registry">{t('library.emptyState.registry')}</p>
    </div>
  );
}

export default Library;
