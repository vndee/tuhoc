import type { Finding } from '@tuhoc/course-format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, type FormEvent, useState } from 'react';
import { MESSAGES, type Lang, type Translate } from '../i18n';
import { useLanguage } from '../i18n/LanguageProvider';
import { AdminNav } from './AdminNav';
import {
  FindingsError,
  type AdminCourseRow,
  adminListCourses,
  adminPublish,
  adminRollback,
  adminUnpublish,
  describeAdminError,
} from './adminApi';

/** Shared TanStack Query cache key for the admin catalog — one entry, invalidated by every write below. */
export function adminCoursesQueryKey(): readonly ['admin', 'courses'] {
  return ['admin', 'courses'] as const;
}

/**
 * `manifest.json` off a chosen package usually names the slug already
 * matching the zip's own filename (`tuhoc pack` names its output that
 * way) — reading it from the filename gives the form a sane default the
 * moment a file is picked, per this task's own brief ("slug đọc từ tên
 * tệp, người dùng sửa được"). It is a DEFAULT, never enforced: the field
 * stays a plain text input the operator can overwrite, and the server's
 * own `ErrSlugMismatch` is the real authority on whether it is correct.
 */
function slugFromFilename(filename: string): string {
  return filename.replace(/\.zip$/i, '');
}

/**
 * `finding.<CODE>` off {@link MESSAGES}, or `null` when this build has no
 * entry for `code` — checked as an object lookup rather than through the
 * typed `t()` (`../i18n/LanguageProvider`) because `code` is a runtime
 * string from the SERVER, not one of the compile-time-known `MessageKey`
 * literals `t()` is typed to accept.
 *
 * Only a PLAIN STRING entry is used, never a function called with no
 * arguments. A few `finding.*` entries take a parameter (`TOO_LARGE`'s MB
 * ceiling, `MANIFEST_MISSING`/`MANIFEST_FIELD`/`MANIFEST_PARSE`'s manifest
 * filename) that this table has no honest value for — the server's own
 * `Finding.Detail` already spells that specific out in English (see
 * `pkgcheck.go`'s `finding()` call sites), so falling through to `detail`
 * for those is MORE accurate than guessing an argument, not a compromise.
 */
function knownFindingMessage(lang: Lang, code: string): string | null {
  const entry = (MESSAGES[lang] as Record<string, unknown>)[`finding.${code}`];
  return typeof entry === 'string' ? entry : null;
}

/**
 * A finding's detail cell: the translated `finding.<CODE>` sentence when
 * this build has one, otherwise the server's own English `detail` —
 * NEVER a blank cell and never the literal string "undefined".
 *
 * This is a DELIBERATE departure from `discuss.reason.unknown`'s own rule
 * ("never draw the raw server text — an unfamiliar code gets one generic,
 * translated sentence instead"). That rule fits a closed, four-value
 * vocabulary read by every anonymous visitor of a public page. A course
 * package's findings are not that: `FindingCode`
 * (`packages/course-format/src/validate.ts`) and "codes this catalog has a
 * `finding.*` entry for" are two DIFFERENT sets, not one — `DUPLICATE_ENTRY`
 * is proof either can hold something the other does not: it is an
 * archive-layer code (`zip.ts`'s `UnsafeArchiveCode`, not `FindingCode`) yet
 * DOES have a key in both catalogs today (`finding.DUPLICATE_ENTRY`, added
 * long before this task by the since-removed local-import feature's own
 * `IMPORT_FINDING_CODES` table) — so `knownFindingMessage` succeeds for it,
 * not falls through. As of this writing every code the current server can
 * actually emit has a matching key; the fallback below exists for the gap
 * that fact does not close — a code the Go side adds AFTER this build
 * shipped, which is a "when", not an "if", given `pkgcheck.go`'s own rule
 * set keeps growing. `AdminCourses.test.tsx` exercises it with a fabricated
 * code (`SOME_FUTURE_CODE`) for exactly that reason: no REAL code was known
 * to be missing at the time this was written, so a real one could not be
 * used as the test's positive case. When the fallback DOES fire on a real
 * package, it is read by the one person who can act on the specific text —
 * the author who just uploaded the rejected package — for whom a generic
 * "unknown problem" would be strictly less useful than the compiler-error-
 * shaped sentence the server already wrote, in the one place on this screen
 * where the reader is assumed to be technical enough to run `tuhoc pack` at
 * a terminal in the first place.
 */
function findingDetail(lang: Lang, finding: Finding): string {
  return knownFindingMessage(lang, finding.code) ?? finding.detail;
}

/**
 * The whole findings table for one rejected 400 — code / path / detail,
 * EVERY finding, not just the first. Shared by the publish form and the
 * rollback picker below: both are "I sent a package, the server checked
 * it, here is everything wrong with it at once", the exact same shape
 * `tuhoc pack` already gives an author at the terminal.
 */
function FindingsTable({ findings, lang, t }: { findings: readonly Finding[]; lang: Lang; t: Translate }) {
  return (
    <div className="admin-findings" role="alert">
      <p className="admin-findings-heading">{t('admin.findings.heading', findings.length)}</p>
      <table className="admin-findings-table">
        <thead>
          <tr>
            <th>{t('admin.findings.code')}</th>
            <th>{t('admin.findings.path')}</th>
            <th>{t('admin.findings.detail')}</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((finding, index) => (
            // Code+path is not always unique (two findings CAN share a path,
            // e.g. two different rule violations in one chapter file), so the
            // index joins the key rather than standing in for it alone.
            <tr key={`${finding.code}-${finding.path}-${index}`}>
              <td>{finding.code}</td>
              <td>{finding.path}</td>
              <td>{findingDetail(lang, finding)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One row of the catalog table: the course itself, plus its unpublish and rollback controls. */
function CourseRow({
  row,
  lang,
  t,
  onChanged,
}: {
  row: AdminCourseRow;
  lang: Lang;
  t: Translate;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pickedVersion, setPickedVersion] = useState('');

  const unpublish = useMutation({
    mutationFn: () => adminUnpublish(row.slug),
    onSuccess: () => {
      setConfirming(false);
      onChanged();
    },
  });

  const rollback = useMutation({
    mutationFn: (version: number) => adminRollback(row.slug, version),
    onSuccess: () => {
      setPickedVersion('');
      onChanged();
    },
  });

  const published = new Date(row.published_at);
  const publishedText = Number.isNaN(published.getTime())
    ? row.published_at
    : published.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

  return (
    <tr>
      <td>{row.slug}</td>
      <td>{row.title}</td>
      <td>{row.version}</td>
      <td>{publishedText}</td>
      <td className="admin-row-actions">
        {confirming ? (
          <p className="admin-confirm">
            {t('admin.unpublish.confirmPrompt', row.slug)}{' '}
            <button
              type="button"
              className="btn primary"
              disabled={unpublish.isPending}
              onClick={() => unpublish.mutate()}
            >
              {t('admin.unpublish.confirmYes')}
            </button>{' '}
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              {t('admin.unpublish.confirmCancel')}
            </button>
          </p>
        ) : (
          <button type="button" className="btn" onClick={() => setConfirming(true)}>
            {t('admin.unpublish.button')}
          </button>
        )}
        {unpublish.isError && (
          <p className="admin-note" role="alert">
            {describeAdminError(unpublish.error, t)}
          </p>
        )}

        <p className="admin-rollback">
          <label>
            <span>{t('admin.rollback.label')}</span>
            <select
              aria-label={t('admin.rollback.label')}
              value={pickedVersion}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => setPickedVersion(event.target.value)}
            >
              <option value="">{t('admin.rollback.placeholder')}</option>
              {row.versions.map((version) => (
                <option key={version} value={version}>
                  {t('admin.rollback.versionOption', version, version === row.version)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn"
            disabled={pickedVersion === '' || rollback.isPending}
            onClick={() => rollback.mutate(Number(pickedVersion))}
          >
            {t('admin.rollback.button')}
          </button>
        </p>
        {/*
          Review round 1, finding 3: `admin.rollback.success` existed in
          both catalogs but nothing read it, unlike publish's own success
          line — the asymmetry was the tell. `rollback.data` (not
          `pickedVersion`, which `onSuccess` above resets to `''` so the
          `<select>` returns to its placeholder) is what still holds the
          version that just landed; it persists across the list refetch
          `onChanged` triggers because that invalidation re-renders this
          row with fresh `row` props, it does not remount `CourseRow`
          (keyed on `row.slug`, not on `row.version`) or reset this
          mutation's own state.
        */}
        {rollback.isSuccess && (
          <p className="admin-note" role="status">
            {t('admin.rollback.success', rollback.data.version)}
          </p>
        )}
        {rollback.isError && rollback.error instanceof FindingsError && (
          <FindingsTable findings={rollback.error.findings} lang={lang} t={t} />
        )}
        {rollback.isError && !(rollback.error instanceof FindingsError) && (
          <p className="admin-note" role="alert">
            {describeAdminError(rollback.error, t)}
          </p>
        )}
      </td>
    </tr>
  );
}

/**
 * `/admin` — publish, unpublish, and roll back course packages from the
 * browser, behind `AdminGuard`. The same server validation `tuhoc pack`
 * runs at the terminal (Task 8's write path): this screen is a second
 * DOOR onto that one gate, not a second gate.
 */
export function AdminCourses() {
  const { t, lang } = useLanguage();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: adminCoursesQueryKey(), queryFn: adminListCourses, retry: false });

  const [file, setFile] = useState<File | null>(null);
  const [slug, setSlug] = useState('');
  // Bumped on a successful publish to remount (and so clear) the file
  // input — `<input type="file">`'s value cannot be reset by writing React
  // state to it directly; a `key` change is the one reliable way to clear
  // a file picker's own choice.
  const [uploadKey, setUploadKey] = useState(0);

  const publish = useMutation({
    mutationFn: ({ slug, zip }: { slug: string; zip: File }) => adminPublish(slug, zip),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminCoursesQueryKey() });
      setFile(null);
      setSlug('');
      setUploadKey((key) => key + 1);
    },
  });

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    setFile(chosen);
    if (chosen !== null) setSlug(slugFromFilename(chosen.name));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedSlug = slug.trim();
    if (file === null || trimmedSlug === '') return;
    publish.mutate({ slug: trimmedSlug, zip: file });
  }

  return (
    <div className="admin-page">
      <AdminNav />
      <div className="admin-header">
        <h1 className="ch-title">{t('admin.title')}</h1>
        <p className="ch-lede">{t('admin.lede')}</p>
      </div>

      <form className="admin-upload" onSubmit={handleSubmit}>
        <h2 className="admin-upload-heading">{t('admin.upload.heading')}</h2>
        <div className="admin-upload-row">
          <label className="admin-upload-field">
            <span>{t('admin.upload.fileLabel')}</span>
            <input key={uploadKey} type="file" accept=".zip" onChange={handleFileChange} />
          </label>
          <label className="admin-upload-field">
            <span>{t('admin.upload.slugLabel')}</span>
            <input type="text" value={slug} onChange={(event) => setSlug(event.target.value)} />
          </label>
          <button
            type="submit"
            className="btn primary"
            disabled={file === null || slug.trim() === '' || publish.isPending}
          >
            {publish.isPending ? t('admin.upload.submitting') : t('admin.upload.submit')}
          </button>
        </div>

        {publish.isSuccess && (
          <p className="admin-note" role="status">
            {t('admin.upload.success', publish.data.slug, publish.data.version)}
          </p>
        )}
        {publish.isError && publish.error instanceof FindingsError && (
          <FindingsTable findings={publish.error.findings} lang={lang} t={t} />
        )}
        {publish.isError && !(publish.error instanceof FindingsError) && (
          <p className="admin-note" role="alert">
            {describeAdminError(publish.error, t)}
          </p>
        )}
      </form>

      {list.isPending && <p className="admin-note">{t('admin.loading')}</p>}
      {list.isError && (
        <p className="admin-note" role="alert">
          {describeAdminError(list.error, t)}
        </p>
      )}
      {list.isSuccess && list.data.length === 0 && <p className="admin-note">{t('admin.empty')}</p>}
      {list.isSuccess && list.data.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('admin.table.slug')}</th>
              <th>{t('admin.table.title')}</th>
              <th>{t('admin.table.version')}</th>
              <th>{t('admin.table.publishedAt')}</th>
              <th>{t('admin.table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((courseRow) => (
              <CourseRow
                key={courseRow.slug}
                row={courseRow}
                lang={lang}
                t={t}
                onChanged={() => void queryClient.invalidateQueries({ queryKey: adminCoursesQueryKey() })}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default AdminCourses;
