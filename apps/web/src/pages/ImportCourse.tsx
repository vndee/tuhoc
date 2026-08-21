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
  const [done, setDone] = useState<{ courseId: string; version: string } | null>(null);
  const [zipUrl, setZipUrl] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

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
    setStage('fetching');
    try {
      const result = await importCourse(source, { onStage: announceStage });
      if (result.ok) {
        setDone({ courseId: result.courseId, version: result.version });
        // The library and this course's manifest are both now stale: the
        // Dashboard lists what it last saw, and `loadManifest` is cached per
        // course id. Without this, a reader who imports a course and clicks
        // straight through gets the copy that was there before.
        await queryClient.invalidateQueries({ queryKey: coursesQueryKey() });
        await queryClient.invalidateQueries({ queryKey: manifestQueryKey(result.courseId) });
      } else {
        setFindings(result.findings);
      }
    } finally {
      setStage(null);
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
        {busy && <p className="import-busy">{STAGE_TEXT[stage]}</p>}
        {done && (
          <p className="import-ok">
            Đã nhập <strong>{done.courseId}</strong> phiên bản {done.version}.{' '}
            <Link to={`/c/${done.courseId}`}>Mở khóa học</Link>
          </p>
        )}
      </div>

      {findings && findings.length > 0 && (
        <div className="import-findings">
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
