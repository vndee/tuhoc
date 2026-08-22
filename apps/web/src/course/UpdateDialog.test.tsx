/**
 * The dialog's job is to let a reader decide, so these tests are about what it
 * SAYS and about what it has not done yet.
 *
 * Nothing here mocks `./version`. The dialog runs the real `previewUpdate`
 * against real Dexie rows and real anchors produced by `selectionToAnchor`,
 * because the one thing worth proving about this screen is that the sentence on
 * it is the truth about the reader's own notes — and a mocked impact would
 * prove that a number can be rendered.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { selectionToAnchor } from '../annotations/anchor';
import { normalizeContainer } from '../annotations/normalize';
import { type AnnotationRow, db, type PackageRow } from '../db/local';
import { UpdateDialog } from './UpdateDialog';

// Same reason as version.test.ts: jsdom never fires load/error for a
// `<script src>`, so the real injector would hang rather than fail. Every test
// below attaches the genuine runtime to `window.CourseKit` instead.
const ensureCourseKitRuntime = vi.hoisted(() => vi.fn(async (): Promise<void> => {}));
vi.mock('../reader/useCourseKit', () => ({ ensureCourseKitRuntime }));

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');

let kitLoaded = false;
function loadCourseKit(): void {
  if (kitLoaded) return;
  for (const file of ['vendor/katex.js', 'vendor/auto-render.js', 'runtime.js']) {
    new Function(readFileSync(resolve(REPO, 'packages/course-kit', file), 'utf8')).call(globalThis);
  }
  kitLoaded = true;
}

const COURSE = 'demo';
const encode = (text: string) => new TextEncoder().encode(text);

const C1_V10 = `
<h1 class="ch-title">Chương một</h1>
<p id="p1">Bất biến của một vòng lặp là một mệnh đề về các biến chương trình, đúng tại đầu mỗi lần kiểm tra điều kiện lặp.</p>
<p id="p2">Kiểm thử là lấy mẫu từ không gian đầu vào; con số mười nghìn đo được công sức bỏ ra, không đo được phần không gian đã phủ.</p>
<p id="p3">Đoạn này biến mất hoàn toàn ở bản 1.1, nên ghi chú neo vào nó không còn chỗ nào để bám.</p>
`;

const C1_V11 = `
<h1 class="ch-title">Chương một</h1>
<p id="p1">Bất biến của một vòng lặp là một mệnh đề về các biến chương trình, đúng tại đầu mỗi lần kiểm tra điều kiện lặp.</p>
<p id="p2">Kiểm thử là lấy mẫu từ không gian đầu vào; con số mười nghìn chỉ đo công sức bỏ ra, không đo phần không gian đã phủ.</p>
`;

function manifestFor(version: string): Record<string, unknown> {
  return {
    id: COURSE,
    title: 'Bất biến vòng lặp',
    description: '',
    lang: 'vi',
    version,
    runtime: '^1',
    parts: [
      {
        title: 'Phần I',
        chapters: [{ id: 'c1', num: '3.4', title: 'Chương một', short: 'Một', file: 'chapters/c1.html' }],
      },
    ],
  };
}

function packageRow(version: string, html: string, pinnedAt: string): PackageRow {
  const manifest = manifestFor(version);
  return {
    key: `${COURSE}@${version}`,
    courseId: COURSE,
    version,
    manifest,
    files: { 'manifest.json': encode(JSON.stringify(manifest)), 'chapters/c1.html': encode(html) },
    pinnedAt,
  };
}

function anchorOver(html: string, selector: string): unknown {
  loadCourseKit();
  const root = document.createElement('div');
  root.innerHTML = html;
  window.CourseKit?.renderKatex(root);
  const target = root.querySelector(selector);
  if (!target) throw new Error(`test fixture: no "${selector}"`);
  const range = document.createRange();
  range.selectNodeContents(target);
  const anchor = selectionToAnchor(normalizeContainer(root), range, 'y');
  if (!anchor) throw new Error(`test fixture: "${selector}" yielded no anchor`);
  return anchor;
}

function note(id: string, anchor: unknown): AnnotationRow {
  return {
    id,
    courseId: COURSE,
    chapterId: 'c1',
    anchor,
    note: `ghi chú ${id}`,
    createdAt: '2026-08-20T09:00:00.000Z',
    updatedAt: '2026-08-20T09:00:00.000Z',
    deletedAt: null,
  };
}

async function seed(): Promise<void> {
  await db.packages.bulkPut([
    packageRow('1.0.0', C1_V10, '2026-08-20T08:00:00.000Z'),
    packageRow('1.1.0', C1_V11, '2026-08-19T08:00:00.000Z'),
  ]);
  await db.annotations.bulkPut([
    note('n-exact', anchorOver(C1_V10, '#p1')),
    note('n-fuzzy', anchorOver(C1_V10, '#p2')),
    note('n-orphan', anchorOver(C1_V10, '#p3')),
  ]);
}

/**
 * Waits until the dry run has finished.
 *
 * NOT `findByRole('button', { name: 'Cập nhật' })`: that button is in the DOM
 * from the first paint, merely disabled, so finding it proves nothing and every
 * assertion after it would race the preview. Enabled is the real signal.
 */
async function awaitPreview(): Promise<void> {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Cập nhật' })).toBeEnabled());
}

async function snapshotDb(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const table of db.tables) out[table.name] = await table.toArray();
  return out;
}

function renderDialog(overrides: Partial<Parameters<typeof UpdateDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onUpdated = vi.fn();
  render(
    <UpdateDialog
      courseId={COURSE}
      courseTitle="Bất biến vòng lặp"
      fromVersion="1.0.0"
      toVersion="1.1.0"
      onClose={onClose}
      onUpdated={onUpdated}
      {...overrides}
    />,
  );
  return { onClose, onUpdated };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  ensureCourseKitRuntime.mockReset();
  ensureCourseKitRuntime.mockResolvedValue(undefined);
  loadCourseKit();
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe('UpdateDialog', () => {
  it('nói thành một câu: giữ đúng chỗ / dịch nhẹ / mất neo', async () => {
    await seed();
    renderDialog();

    expect(await screen.findByText('1/3 ghi chú giữ đúng chỗ · 1 dịch nhẹ · 1 mất neo')).toBeInTheDocument();
    expect(screen.getByText('v1.0.0 → v1.1.0')).toBeInTheDocument();
  });

  it('gọi tên chương của ghi chú mất neo theo mục lục, không phải theo id', async () => {
    await seed();
    renderDialog();

    expect(await screen.findByText('3.4 · Chương một')).toBeInTheDocument();
  });

  it('nói rõ ghi chú mất neo KHÔNG bị xoá', async () => {
    await seed();
    renderDialog();

    await awaitPreview();
    // `toHaveTextContent` rather than `getByText`: the sentence is deliberately
    // broken up by a `<b>`, so no single element holds all of it.
    expect(screen.getByRole('dialog')).toHaveTextContent('Ghi chú mất neo không bị xoá');
  });

  it('mở lên KHÔNG ghi gì: cả database y nguyên', async () => {
    await seed();
    const before = await snapshotDb();

    renderDialog();
    await awaitPreview();

    expect(await snapshotDb()).toEqual(before);
  });

  it('“Ở lại” đóng dialog và không đổi phiên bản đang ghim', async () => {
    await seed();
    const { onClose, onUpdated } = renderDialog();
    await awaitPreview();

    await userEvent.click(screen.getByRole('button', { name: 'Ở lại v1.0.0' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onUpdated).not.toHaveBeenCalled();
    const pinned = await db.packages.get(`${COURSE}@1.1.0`);
    expect(pinned?.pinnedAt).toBe('2026-08-19T08:00:00.000Z');
  });

  it('“Cập nhật” ghim bản mới, giữ nguyên mọi ghi chú, rồi đóng', async () => {
    await seed();
    const { onClose, onUpdated } = renderDialog();
    await awaitPreview();

    await userEvent.click(screen.getByRole('button', { name: 'Cập nhật' }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith('1.1.0'));
    expect(onClose).toHaveBeenCalledTimes(1);

    const pinned = await db.packages.get(`${COURSE}@1.1.0`);
    expect(Date.parse(pinned!.pinnedAt)).toBeGreaterThan(Date.parse('2026-08-20T08:00:00.000Z'));

    const rows = await db.annotations.toArray();
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.deletedAt === null)).toBe(true);
  });

  it('không mời bấm “Cập nhật” khi chưa đo xong', async () => {
    await seed();
    renderDialog();

    expect(screen.getByRole('button', { name: 'Cập nhật' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cập nhật' })).toBeEnabled());
  });

  it('không đo được thì nói ra, và không cho bấm cập nhật', async () => {
    await db.annotations.put(note('n-exact', anchorOver(C1_V10, '#p1')));
    // Neither version is on this device and there is no server to ask.
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    renderDialog();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cập nhật' })).toBeDisabled();
  });

  it('tách ghi chú VỐN ĐÃ mất neo ra khỏi thiệt hại của bản cập nhật', async () => {
    await db.packages.bulkPut([
      packageRow('1.0.0', C1_V10, '2026-08-20T08:00:00.000Z'),
      packageRow('1.1.0', C1_V11, '2026-08-19T08:00:00.000Z'),
    ]);
    await db.annotations.put(
      note('n-was-already-lost', {
        exact: 'một câu chưa từng có trong bất kỳ phiên bản nào của chương này',
        prefix: '',
        suffix: '',
        color: 'y',
      }),
    );

    renderDialog();

    expect(await screen.findByText(/vốn đã mất neo từ trước/)).toBeInTheDocument();
  });

  it('khoá học chưa có ghi chú nào thì nói thẳng là không ảnh hưởng gì', async () => {
    await db.packages.bulkPut([
      packageRow('1.0.0', C1_V10, '2026-08-20T08:00:00.000Z'),
      packageRow('1.1.0', C1_V11, '2026-08-19T08:00:00.000Z'),
    ]);

    renderDialog();

    expect(await screen.findByText(/không ảnh hưởng gì/)).toBeInTheDocument();
  });

  it('Escape đóng dialog', async () => {
    await seed();
    const { onClose } = renderDialog();
    await awaitPreview();

    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
