/**
 * The screen that turns "this course changed under you" into a decision.
 *
 * It opens on a version the reader has NOT taken, runs `previewUpdate` — a dry
 * run that writes nothing (see `./version`'s header) — and says, in one line,
 * what taking it would cost:
 *
 *     Cập nhật "Lý thuyết thông tin"
 *     v1.0.0 → v1.1.0
 *     37/40 ghi chú giữ đúng chỗ · 2 dịch nhẹ · 1 mất neo (chương 3.4)
 *     [ Cập nhật ]   [ Ở lại v1.0.0 ]
 *
 * ## Three things this component is careful about
 *
 * **Opening it changes nothing.** The preview runs on mount; `applyUpdate` runs
 * only from the confirm button. A reader can open this, read it, and close it,
 * and their device is byte-for-byte where it was. That is enforced in
 * `./version`, and it is the reason this dialog can be offered freely rather
 * than guarded behind an "are you sure".
 *
 * **It says what happens to the notes that lose their place**, right next to
 * the number, because "1 mất neo" read on its own sounds like "1 deleted". It
 * is not: the note keeps every word and moves to the orphan panel (P2 Task 7)
 * for the reader to re-attach by hand.
 *
 * **It distinguishes damage this update would do from damage already done.** A
 * note can be unplaceable on the version the reader is already reading — see
 * `OrphanedNote.alreadyOrphaned` — and counting those as a cost of updating
 * would talk a reader out of an update that costs them nothing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UnsafePackageError } from '../api/courses';
import { describeFinding } from './import';
import { describeCourseError, loadManifest } from './loader';
import {
  applyUpdate,
  CourseKitUnavailableError,
  PackageVersionUnavailableError,
  previewUpdate,
  type UpdateImpact,
} from './version';

export interface UpdateDialogProps {
  readonly courseId: string;
  /** The course's own title, for the heading. The caller is already showing it. */
  readonly courseTitle: string;
  /** The version this device opens today. */
  readonly fromVersion: string;
  /** The version on offer. */
  readonly toVersion: string;
  /** Dismiss — from "Ở lại", from Escape, from the scrim, and after a successful update. */
  readonly onClose: () => void;
  /** Called after `applyUpdate` has committed, before `onClose`. Task 9's library refetches on it. */
  readonly onUpdated?: (version: string) => void;
}

/**
 * Where the dialog is in its one-way sequence.
 *
 * A discriminated union rather than four booleans, so "still measuring",
 * "measured", "committing" and "it went wrong" cannot be true at once — the
 * failure this shape rules out is a confirm button that is live while the
 * numbers behind it are still being computed.
 */
type Stage =
  | { readonly kind: 'previewing' }
  | { readonly kind: 'ready'; readonly impact: UpdateImpact }
  | { readonly kind: 'applying'; readonly impact: UpdateImpact }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'apply-failed'; readonly impact: UpdateImpact; readonly message: string };

/** The starting stage, as one shared value so it keeps its identity across renders. */
const PREVIEWING: Stage = { kind: 'previewing' };

/** Vietnamese for the failures this flow can actually produce. */
function describeError(error: unknown): string {
  if (error instanceof CourseKitUnavailableError) {
    return 'Chưa xem trước được: không tải được bộ dựng chương (công thức toán). Hãy kiểm tra kết nối rồi thử lại.';
  }
  if (error instanceof UnsafePackageError) {
    // A refusal, not a failure — and the reader is told which it is, because
    // the two ask for opposite things from them. "Try again" is the wrong
    // advice here: retrying downloads the same bytes and refuses them again.
    // `describeFinding` is `/import`'s wording, reused rather than reworded so
    // one package cannot be described two ways on two screens.
    return `Không thể cập nhật: bản ${error.version} tự khai là hạng “content” (chỉ có chữ) nhưng lại chứa mã chạy được. ${error.findings
      .slice(0, 3)
      .map(describeFinding)
      .join(' ')}`;
  }
  if (error instanceof PackageVersionUnavailableError) {
    return `Chưa xem trước được: không lấy được bản ${error.version} của khoá học này.`;
  }
  return describeCourseError(error);
}

/**
 * `chapterId` → the label a reader recognises ("3.4 · Tên chương").
 *
 * Read off the manifest of the version they are ON, not the one on offer: an
 * orphan's chapter may have been deleted by the update, in which case the new
 * manifest has no name for it and the old one does. Best-effort — a manifest
 * that will not load leaves the ids showing, which is worse than a name and far
 * better than an empty list.
 */
async function chapterLabels(courseId: string): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  try {
    const manifest = await loadManifest(courseId);
    for (const part of manifest.parts) {
      for (const chapter of part.chapters) {
        labels.set(chapter.id, chapter.num ? `${chapter.num} · ${chapter.title}` : chapter.title);
      }
    }
  } catch (error) {
    console.warn(`course/UpdateDialog: could not name the chapters of "${courseId}"`, error);
  }
  return labels;
}

/** The one-line verdict. Kept as a list of clauses so the separator is written once. */
function summaryOf(impact: UpdateImpact): string {
  const clauses = [`${impact.exact}/${impact.total} ghi chú giữ đúng chỗ`];
  if (impact.fuzzy > 0) clauses.push(`${impact.fuzzy} dịch nhẹ`);
  if (impact.orphaned.length > 0) clauses.push(`${impact.orphaned.length} mất neo`);
  return clauses.join(' · ');
}

export function UpdateDialog({
  courseId,
  courseTitle,
  fromVersion,
  toVersion,
  onClose,
  onUpdated,
}: UpdateDialogProps) {
  /**
   * The stage, tagged with the question it answers.
   *
   * Carrying the key rather than resetting the stage from an effect: the props
   * identify ONE comparison, and a `setStage({ kind: 'previewing' })` at the top
   * of the effect below would be a synchronous setState during an effect — a
   * second render pass whose only job is to undo a value that is already
   * knowable during the first. Deriving it means a dialog re-pointed at a
   * different version can never, for even one paint, show the previous
   * version's numbers under the new version's heading.
   */
  const question = `${courseId}@${fromVersion}->${toVersion}`;
  const [answer, setAnswer] = useState<{ readonly question: string; readonly stage: Stage } | null>(null);
  // `useMemo` + the shared `PREVIEWING` constant, not a bare ternary: `confirm`
  // below closes over this, and a fresh `{ kind: 'previewing' }` literal every
  // render would give that callback a new identity on every render too.
  const stage = useMemo<Stage>(
    () => (answer && answer.question === question ? answer.stage : PREVIEWING),
    [answer, question],
  );
  const setStage = useCallback((next: Stage) => setAnswer({ question, stage: next }), [question]);

  const [labels, setLabels] = useState<ReadonlyMap<string, string>>(new Map());
  const boxRef = useRef<HTMLDivElement | null>(null);

  // The dry run. `cancelled` rather than an AbortController because there is
  // nothing to abort — `previewUpdate` writes nothing and its only cost is the
  // work it has already started; all this guards is a setState after unmount.
  useEffect(() => {
    let cancelled = false;

    void chapterLabels(courseId).then((found) => {
      if (!cancelled) setLabels(found);
    });

    previewUpdate(courseId, fromVersion, toVersion).then(
      (impact) => {
        if (!cancelled) setStage({ kind: 'ready', impact });
      },
      (error: unknown) => {
        console.warn(`course/UpdateDialog: could not preview ${courseId} ${fromVersion} → ${toVersion}`, error);
        if (!cancelled) setStage({ kind: 'failed', message: describeError(error) });
      },
    );

    return () => {
      cancelled = true;
    };
    // `setStage` is listed even though it is derived from the other three:
    // it changes exactly when they do, so it adds no re-runs, and leaving it
    // out would be a lint suppression rather than a smaller dependency list.
  }, [courseId, fromVersion, toVersion, setStage]);

  // Escape has to work without the reader clicking into the dialog first.
  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  const confirm = useCallback(() => {
    if (stage.kind !== 'ready') return;
    const impact = stage.impact;
    setStage({ kind: 'applying', impact });
    applyUpdate(courseId, toVersion).then(
      () => {
        onUpdated?.(toVersion);
        onClose();
      },
      (error: unknown) => {
        console.warn(`course/UpdateDialog: could not apply ${courseId}@${toVersion}`, error);
        setStage({ kind: 'apply-failed', impact, message: describeError(error) });
      },
    );
  }, [courseId, onClose, onUpdated, setStage, stage, toVersion]);

  const impact = stage.kind === 'ready' || stage.kind === 'applying' || stage.kind === 'apply-failed' ? stage.impact : null;
  const busy = stage.kind === 'applying';
  const alreadyLost = impact ? impact.orphaned.filter((row) => row.alreadyOrphaned).length : 0;

  return createPortal(
    <>
      {/* Presentation only: the box below carries the dialog role, and
          Escape / "Ở lại" are the keyboard ways out. Same split as
          `annotations/MarginCards`'s sheet. */}
      <div className="cu-scrim" aria-hidden="true" onClick={busy ? undefined : onClose} />
      <div
        className="cu-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cu-title"
        tabIndex={-1}
        ref={boxRef}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) onClose();
        }}
      >
        <h2 className="cu-title" id="cu-title">
          Cập nhật “{courseTitle}”
        </h2>
        <p className="cu-versions">
          v{fromVersion} → v{toVersion}
        </p>

        {stage.kind === 'previewing' && (
          <p className="cu-status" role="status">
            Đang thử neo lại ghi chú của bạn trên bản mới…
          </p>
        )}

        {stage.kind === 'failed' && (
          <p className="cu-error" role="alert">
            {stage.message}
          </p>
        )}

        {impact && impact.total === 0 && (
          <p className="cu-summary">Bạn chưa có ghi chú nào trong khoá học này, nên cập nhật không ảnh hưởng gì.</p>
        )}

        {impact && impact.total > 0 && (
          <>
            <p className="cu-summary">{summaryOf(impact)}</p>
            {impact.orphaned.length > 0 && (
              <>
                <ul className="cu-orphans">
                  {impact.orphaned.map((row) => (
                    <li key={row.id}>
                      <span className="cu-orphan-where">{labels.get(row.chapterId) ?? row.chapterId}</span>
                      <span className="cu-orphan-quote">{row.exact.replace(/\s+/g, ' ').trim().slice(0, 80)}</span>
                    </li>
                  ))}
                </ul>
                {alreadyLost > 0 && (
                  <p className="cu-note">
                    Trong đó <b>{alreadyLost}</b> ghi chú vốn đã mất neo từ trước — ở lại v{fromVersion} cũng không cứu
                    được.
                  </p>
                )}
                <p className="cu-note">
                  Ghi chú mất neo <b>không bị xoá</b>. Chúng vào mục “chưa gắn lại được” trong chương, còn nguyên từng
                  chữ, để bạn nối lại bằng tay.
                </p>
              </>
            )}
          </>
        )}

        {stage.kind === 'apply-failed' && (
          <p className="cu-error" role="alert">
            {stage.message}
          </p>
        )}

        <div className="cu-actions">
          <button
            type="button"
            className="cu-confirm"
            disabled={stage.kind === 'previewing' || stage.kind === 'failed' || busy}
            onClick={confirm}
          >
            {busy ? 'Đang cập nhật…' : 'Cập nhật'}
          </button>
          <button type="button" className="cu-cancel" disabled={busy} onClick={onClose}>
            Ở lại v{fromVersion}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

export default UpdateDialog;
