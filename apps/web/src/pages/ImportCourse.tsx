import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link } from 'react-router-dom';
import { coursesQueryKey } from '../api/courses';
import { describeFinding, importCourse, type ImportSource, type ImportStage } from '../course/import';
import { manifestQueryKey } from '../course/loader';
import type { Finding } from '@tuhoc/course-format';

/**
 * `/import` — the one screen where a reader brings a course in.
 *
 * Three ways in, in the order they are actually used: a `.zip` from this
 * device, a `.zip` at a link somebody sent, and a public GitHub repo. They
 * are three separate controls rather than one clever box that sniffs what
 * was pasted, because the three fail differently and the reader needs to
 * know which one they are being told about.
 *
 * ## The sentence about private repos is part of the feature
 *
 * `course/import.ts` explains the decision; this file is where a reader
 * meets it. It is printed NEXT TO the repo field, before anything is
 * pasted — not only in the error afterwards — because "why can I not paste
 * my own repo" is a question worth answering before it is asked, and because
 * GitHub's 404 for a private repo is indistinguishable from its 404 for a
 * typo. A reader who has read this line already knows which of the two to
 * check first.
 *
 * ## Waiting states are honest
 *
 * `validatePackage` tokenizes every byte of the package on the main thread —
 * roughly a second for a package at the full 20 MB budget, measured. The
 * import reports a stage before each phase and yields before the scan, so
 * "Đang kiểm tra nội dung gói…" is on screen while the thread is busy rather
 * than queued behind it. A spinner that appears after the freeze is over is
 * worse than none.
 */
export function ImportCourse() {
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<ImportStage | null>(null);
  const [findings, setFindings] = useState<readonly Finding[] | null>(null);
  const [done, setDone] = useState<
    { courseId: string; version: string; rerootedFrom?: string; droppedFiles?: number } | null
  >(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [zipUrl, setZipUrl] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

  const busy = stage !== null;

  /**
   * Commit the stage line SYNCHRONOUSLY, so it is in the DOM before
   * `importCourse` ends its task and the browser gets its turn to draw.
   *
   * `flushSync` and not a plain `setStage`, and this is the one line in this
   * file that was written from a measurement rather than from taste. Driven
   * in real Chromium against a 19.71 MiB package, a `MessageChannel`
   * heartbeat showed React's commit of "Đang kiểm tra nội dung gói…" landing
   * INSIDE the same 1.4-second task as the scan it was announcing — so the
   * page froze still showing the previous line and the waiting state was
   * never seen. Nothing in the jsdom suite can observe that; it took the
   * browser. See `course/import.ts`'s `stageAnnouncer` for the other half.
   */
  const announceStage = useCallback((next: ImportStage) => {
    flushSync(() => setStage(next));
  }, []);

  async function run(source: ImportSource) {
    setFindings(null);
    setDone(null);
    setCancelled(false);
    setProgress(null);
    setStage('fetching');
    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = await importCourse(source, {
        onStage: announceStage,
        // No `flushSync` here, and the difference is not an oversight: this
        // fires between network round trips with the main thread idle, so
        // React gets a paint of its own. `onStage` is the one that is
        // immediately followed by a second of synchronous work.
        onProgress: (done, total) => setProgress({ done, total }),
        signal: controller.signal,
      });
      if (!result.ok && result.findings.length === 1 && result.findings[0].code === 'CANCELLED') {
        // A cancellation is not a rejected package. Putting it under "Không
        // nhập được gói này" would tell a reader their file was bad when what
        // happened is that they pressed the button they were offered.
        setCancelled(true);
      } else if (result.ok) {
        setDone({
          courseId: result.courseId,
          version: result.version,
          rerootedFrom: result.rerootedFrom,
          droppedFiles: result.droppedFiles,
        });
        // The library and this course's manifest are both now stale: the
        // Dashboard lists what it last saw, and `loadManifest` is cached per
        // course id. Without this, a reader who imports a course and clicks
        // straight through gets the copy that was there before.
        await queryClient.invalidateQueries({ queryKey: coursesQueryKey() });
        await queryClient.invalidateQueries({ queryKey: manifestQueryKey(result.courseId) });
      } else {
        setFindings(result.findings);
      }
    } catch (cause) {
      // `try { … } finally { … }` with no `catch` was this file's original
      // shape, and it is how a reader got a BLANK SCREEN: anything thrown out
      // of `importCourse` became an `unhandledrejection`, the stage line was
      // cleared by the `finally`, and not one pixel said why. Measured in a
      // real browser against a server that cut the response body mid-package.
      //
      // `importCourse` now promises never to throw and has its own net, so
      // reaching here means that promise was broken — which is exactly when
      // a page must still say something rather than trust a contract.
      setFindings([
        { code: 'UNEXPECTED', path: '.', detail: `(${cause instanceof Error ? cause.message : String(cause)})` },
      ]);
    } finally {
      setStage(null);
      setProgress(null);
      abort.current = null;
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <div className="import-page">
      <h1 className="ch-title">Nhập khóa học</h1>
      <p className="ch-lede">
        Một khóa học là một gói <code>.zip</code>. Sau khi nhập, gói nằm trên máy bạn và đọc được cả khi mất mạng.
      </p>

      <section className="import-way">
        <h2 className="import-way-h">Từ tệp trên máy</h2>
        <label className="import-file">
          <span className="import-label">Chọn gói .zip</span>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void run({ kind: 'file', file });
            }}
          />
        </label>
      </section>

      <section className="import-way">
        <h2 className="import-way-h">Từ một đường dẫn .zip</h2>
        <form
          className="import-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (zipUrl.trim() !== '') void run({ kind: 'zipUrl', url: zipUrl.trim() });
          }}
        >
          <label className="import-label" htmlFor="import-zip-url">
            Đường dẫn tới tệp .zip
          </label>
          <input
            id="import-zip-url"
            type="url"
            className="import-input"
            placeholder="https://vi-du.com/khoa-hoc.zip"
            value={zipUrl}
            disabled={busy}
            onChange={(e) => setZipUrl(e.target.value)}
          />
          <button type="submit" className="btn" disabled={busy || zipUrl.trim() === ''}>
            Nhập từ đường dẫn
          </button>
        </form>
      </section>

      <section className="import-way">
        <h2 className="import-way-h">Từ repo GitHub công khai</h2>
        <form
          className="import-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (gitUrl.trim() !== '') void run({ kind: 'gitUrl', url: gitUrl.trim() });
          }}
        >
          <label className="import-label" htmlFor="import-git-url">
            Đường dẫn repo
          </label>
          <input
            id="import-git-url"
            type="url"
            className="import-input"
            placeholder="https://github.com/nguoi-dung/khoa-hoc"
            value={gitUrl}
            disabled={busy}
            onChange={(e) => setGitUrl(e.target.value)}
          />
          <button type="submit" className="btn" disabled={busy || gitUrl.trim() === ''}>
            Nhập từ repo
          </button>
        </form>
        <p className="import-note">
          Chỉ nhập được từ repo <strong>công khai</strong>. Repo riêng tư cần token truy cập, và tuhoc cố ý không giữ
          token của bạn. Nếu khóa học nằm trong repo riêng tư, hãy tải <code>.zip</code> của repo về máy rồi dùng
          “Từ tệp trên máy” ở trên — kết quả giống hệt.
        </p>
      </section>

      <div className="import-status" role="status" aria-live="polite">
        {busy && (
          <p className="import-busy">
            {STAGE_TEXT[stage]}
            {/*
              The repo route makes one request per file, and that is a wait
              worth counting rather than hiding: 313 files took 20.04 s in
              review, for 188 KB — the cost is round trips, so it grows with
              the file count and nothing here makes it fast. A static line
              for twenty seconds reads as a hung page.
            */}
            {/*
              Only while FETCHING, and that clause was added from looking at
              the real screen rather than from thinking about it: driving a
              25-file repo in Chromium, the counter survived into the next
              stage and printed "Đang kiểm tra nội dung gói… 24/25 tệp.",
              which reads as if the scan were still downloading with one file
              to go. A count belongs to the phase that produced it.
            */}
            {stage === 'fetching' && progress && ` ${progress.done}/${progress.total} tệp.`}
          </p>
        )}
        {/*
          The one control that is NOT `disabled={busy}` — before this there
          was no way to stop an import except closing the tab. Offered only
          while fetching, because that is the only stage it can actually
          interrupt: the scan holds the main thread, so a "Huỷ" that did
          nothing during it would be a lie in button form.
        */}
        {stage === 'fetching' && (
          <button type="button" className="btn" onClick={() => abort.current?.abort()}>
            Huỷ
          </button>
        )}
        {cancelled && <p className="import-note">Đã huỷ nhập gói. Không có gì được lưu lại.</p>}
        {done && (
          <p className="import-ok">
            Đã nhập <strong>{done.courseId}</strong> phiên bản {done.version}.{' '}
            <Link to={`/c/${done.courseId}`}>Mở khóa học</Link>
          </p>
        )}
        {/*
          What was imported is not always what was handed in, and the reader
          is the one who has to be able to tell. `course/import.ts` re-roots
          an archive whose package sits inside a folder — every GitHub
          zipball, everything Finder's "Compress" produces — and drops
          whatever was outside that folder. Both halves are said here,
          because a silent reinterpretation of somebody's file is
          indistinguishable from a bug the first time it picks wrong: an
          archive holding a course and a sample of one, imported without a
          word, gives no way to know which arrived.
        */}
        {done?.rerootedFrom && (
          <p className="import-note">
            Gói nằm trong thư mục <code>{done.rerootedFrom}/</code> của tệp bạn chọn, nên tuhoc đã lấy thư mục đó làm
            gốc gói
            {done.droppedFiles ? ` và bỏ qua ${done.droppedFiles} tệp nằm ngoài nó` : ''}.
          </p>
        )}
      </div>

      {/*
        `role="alert"` and not merely a heading: this block is a SIBLING of
        the `role="status"` region, so before this a screen-reader user
        pressed "Nhập", heard the waiting state, heard it disappear, and was
        told nothing at all about why the package was refused. An alert is
        the right politeness level too — the reader asked for this and the
        answer is that it did not happen.
      */}
      {findings && findings.length > 0 && (
        <div className="import-findings" role="alert">
          <h2 className="import-way-h">Không nhập được gói này</h2>
          <p className="import-note">
            {findings.length === 1
              ? 'Có một vấn đề cần sửa:'
              : `Có ${findings.length} vấn đề, liệt kê hết ở đây để bạn sửa một lượt:`}
          </p>
          <ul className="import-finding-list">
            {findings.map((f, i) => (
              <li key={`${f.code}:${f.path}:${i}`}>{describeFinding(f)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * What each phase is called on screen. Named phases rather than one
 * "Đang xử lý…": the three of them fail for different reasons and take
 * wildly different amounts of time, and a reader watching a 40-file repo
 * download should be able to tell that from a reader watching a 20 MB
 * package get scanned.
 */
const STAGE_TEXT: Record<ImportStage, string> = {
  fetching: 'Đang tải gói…',
  unpacking: 'Đang giải nén…',
  checking: 'Đang kiểm tra nội dung gói…',
  saving: 'Đang lưu vào máy bạn…',
};

export default ImportCourse;
