import { useEffect, useState } from 'react';

/**
 * The three course-kit runtime scripts every course shares, in the order
 * they must execute: `katex.js` defines `window.katex`; `auto-render.js`
 * reads `window.katex` and defines `window.renderMathInElement`;
 * `runtime.js` defines `window.CourseKit` (whose `renderKatex` wraps
 * `renderMathInElement`) and the `Plot`/`defineViz` machinery a course's
 * own viz.js needs. These are classic scripts that attach globals, not ES
 * modules — see vite.config.ts's `@course-kit` alias comment for why they
 * must be loaded via `<script src>` rather than `import`.
 */
const RUNTIME_SCRIPT_URLS = [
  '/course-kit/vendor/katex.js',
  '/course-kit/vendor/auto-render.js',
  '/course-kit/runtime.js',
] as const;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error(`useCourseKit: failed to load ${src}`)));
    document.head.appendChild(script);
  });
}

// Module-level, not component state: these scripts attach GLOBALS
// (window.katex, window.renderMathInElement, window.CourseKit). Injecting
// the shared trio a second time — from a second <ChapterView> mount, or
// React 18 StrictMode's dev-only mount->cleanup->mount cycle — would not
// just be wasted network requests: runtime.js would re-run and silently
// replace window.CourseKit.REDRAWS with a brand-new empty array, orphaning
// every canvas already registered against the old one (they would stop
// repainting on the next theme toggle). A promise cached at module scope,
// not per-render state, is what survives that: every caller across the
// app's lifetime awaits the SAME promise instead of re-triggering the
// injection.
let runtimeTrioPromise: Promise<void> | null = null;

/**
 * The shared trio, loaded at most once per app lifetime, as a plain promise.
 *
 * Exported (Task 10) because `useCourseKit` is not the only thing that needs
 * `window.CourseKit`, and the second caller is not a component. `course/version.ts`
 * resolves a reader's anchors against a chapter of a version they have not taken
 * yet, and an anchor's stored quote describes the chapter AFTER
 * `CourseKit.renderKatex` has run — one `'￼'` per formula rather than the
 * literal `$…$` source. Measured on the real p1-5 with 30 notes: previewing
 * without the trio reported 26 orphans where 4 was the truth, and 17 of those
 * were paragraphs the update did not touch at all.
 *
 * A second injector living in that file would be a second copy of the
 * "these globals must be attached exactly once, in this order" rule — the
 * rule the module-level singleton below exists to enforce.
 */
export function ensureCourseKitRuntime(): Promise<void> {
  if (runtimeTrioPromise) return runtimeTrioPromise;

  runtimeTrioPromise = (async () => {
    for (const src of RUNTIME_SCRIPT_URLS) {
      await loadScript(src);
    }
  })();

  // A failed load must not wedge the whole app forever on a rejected
  // singleton — reset it so a *later* mount (e.g. after a transient
  // network blip, or a route revisit) gets a clean retry.
  runtimeTrioPromise.catch(() => {
    runtimeTrioPromise = null;
  });

  return runtimeTrioPromise;
}

/**
 * Khoá học nào đã nạp XONG runtime của nó, ở mức module — cùng hạng với
 * `runtimeTrioPromise`, và vì cùng một lý do.
 *
 * Không có nó, `useCourseKit` vứt đi chính điều đó tồn tại để giữ: mỗi lần
 * mount lại bắt đầu từ `ready: false` và ở đó cho tới khi
 * `ensureCourseKitRuntime()` settle lại — dù mọi global đã gắn vào `window`
 * từ lâu (nó là một singleton đã resolve) và không có gì để tải nữa. Đo trên
 * bản dựng thật: 30–400ms mỗi lần vào một chương, trong đó `<ChapterView>` in
 * "Đang tải chương…" đè lên một chương nó đã có sẵn.
 *
 * Một `Set` chỉ-thêm là đủ và đúng: script đã gắn global thì không gỡ ra được,
 * nên một courseId đã vào đây thì vĩnh viễn còn đúng. Đường thất bại không ghi
 * vào đây (xem nhánh lỗi trong effect), nên nó không bao giờ hứa nhầm.
 *
 * Vẫn khoá theo `courseId` dù `ensureCourseKitRuntime()` giờ là sự thật DÙNG
 * CHUNG cho mọi khoá (không còn `viz.js` riêng của từng khoá — Task 10 của
 * cú xoay trục server-side; xem `course/loader.ts`) — Task 11 mới dọn nốt
 * phần còn lại (`initViz`, sổ REDRAWS) ở `ChapterView.tsx`. Giữ nguyên hình
 * dạng theo courseId ở đây là chủ ý: nó vẫn cho đúng hành vi (mount lại một
 * khoá đã sẵn sàng thì `ready` ngay, đổi khoá giữa một lần mount thì chờ lại)
 * mà không cần viết lại cách hook này theo dõi trạng thái.
 */
const readyCourseIds = new Set<string>();

export interface UseCourseKitResult {
  /** True once katex.js, auto-render.js, runtime.js and — if this course has one — its viz.js have all loaded and attached their globals. */
  ready: boolean;
  /** Set if any of them failed to load. `ready` stays false in that case — surface this rather than hanging silently. */
  error: Error | null;
}

/**
 * Loads the course-kit runtime for `courseId`: the shared katex/auto-
 * render/runtime trio, once per app lifetime, and reports readiness.
 * `ChapterView` must not touch `window.CourseKit` until `ready` is true.
 *
 * **Deliberately partial, per Task 10 of the server-side pivot.** Through
 * ruling S1-F14 this hook also decided WHETHER a course had its own
 * `viz.js` and, if so, injected it after the trio — a question that made
 * sense when a course could be a cached package, a static directory, or a
 * pull from the server (see `course/loader.ts`'s old header comment). Under
 * the new architecture a chapter's interactive parts are widgets rendered
 * in sandboxed iframes (spec §2.3), not a course-wide `<script src>`, so
 * that whole question — and the per-script map that answered it — has
 * nowhere left to apply. Task 11 removes `initViz`/`REDRAWS` from
 * `ChapterView.tsx` and finishes wiring widgets through this hook; this
 * task only drops the now-dead viz branch so the module keeps compiling and
 * KaTeX keeps working in the meantime.
 */
function initialFor(courseId: string): UseCourseKitResult {
  return { ready: readyCourseIds.has(courseId), error: null };
}

export function useCourseKit(courseId: string): UseCourseKitResult {
  const [result, setResult] = useState<UseCourseKitResult>(() => initialFor(courseId));

  /**
   * ĐỔI KHOÁ HỌC GIỮA MỘT LẦN MOUNT thì câu trả lời cũ hết hiệu lực.
   *
   * `<Reader>` không bị dựng lại khi chỉ đổi tham số route, nên đi thẳng từ một
   * chương của khoá A sang một chương của khoá B chỉ là một lần render mới với
   * `courseId` khác. Bản trước để nguyên state ở đó: `ready` vẫn `true` từ khoá
   * A trong khi `viz.js` của khoá B chưa tải, và `<ChapterView>` gọi `initViz`
   * trên một sổ đăng ký chưa có mô phỏng nào của B — mọi khung mô phỏng ra chỗ
   * giữ chỗ "chưa sẵn sàng".
   *
   * Đặt state NGAY TRONG THÂN RENDER chứ không trong một effect: React nhận ra
   * mẫu này và render lại ngay trước khi commit, nên không có một khung nào bị
   * vẽ ra với câu trả lời của khoá cũ.
   */
  const [seenCourseId, setSeenCourseId] = useState(courseId);
  if (seenCourseId !== courseId) {
    setSeenCourseId(courseId);
    setResult(initialFor(courseId));
  }

  useEffect(() => {
    let cancelled = false;

    ensureCourseKitRuntime().then(
      () => {
        readyCourseIds.add(courseId);
        if (!cancelled) setResult({ ready: true, error: null });
      },
      (err: unknown) => {
        if (!cancelled) setResult({ ready: false, error: err instanceof Error ? err : new Error(String(err)) });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [courseId]);

  return result;
}

/** Test-only: reset the module-level singleton/set between test files/cases. Not exported for app code. */
export function __resetCourseKitForTests(): void {
  runtimeTrioPromise = null;
  readyCourseIds.clear();
}
