/**
 * `index.json` — one file, one request.
 *
 * The load-bearing test here is the SEMVER one. This project has walked into
 * lexicographic version ordering **twice** already (once on the Go side, once
 * in `scripts/course_workspace.py`, whose comment at line 173 names the trap by
 * hand: *"1.10.0 đứng TRƯỚC 1.9.0"*). It walks into it a third time the moment
 * somebody writes `versions.sort()` and it looks right on `1.0.0 … 1.9.0`.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir as osTmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { buildIndex, INDEX_SCHEMA } from './build-index.ts';
import { compareSemver } from './semver.ts';
import { EmptyRegistryError } from './tree.ts';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const FIXTURE_COURSES = join(REPO_ROOT, 'fixtures', 'courses');

const cleanup: string[] = [];
afterAll(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function tmproot(): string {
  const dir = mkdtempSync(join(osTmpdir(), 'tuhoc-registry-idx-'));
  cleanup.push(dir);
  return dir;
}

function writeCourse(dir: string, id: string, version: string): void {
  mkdirSync(join(dir, 'chapters'), { recursive: true });
  const manifest = {
    id,
    title: 'Gói thử',
    description: 'Gói dùng cho test index',
    lang: 'vi',
    version,
    runtime: '^1',
    license: 'CC-BY-4.0',
    authors: [{ name: 'test' }],
    generatedBy: 'human',
    parts: [{ title: 'Phần I', chapters: [{ id: 'c1', num: '1.1', title: 'C', short: 'C', file: 'chapters/c1.html' }] }],
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(dir, 'chapters', 'c1.html'), '<p>nội dung</p>');
}

/** `<root>/<id>/<version>/…` — the layout that can hold more than one version. */
function fixtureWithVersions(versions: string[], id = 'course-nhieu-ban'): string {
  const root = tmproot();
  for (const v of versions) {
    const dir = join(root, id, v);
    mkdirSync(dirname(dir), { recursive: true });
    writeCourse(dir, id, v);
  }
  return root;
}

describe('sắp phiên bản bằng SEMVER, không bằng thứ tự từ điển', () => {
  it('latest là 1.10.0 chứ không phải 1.9.0', async () => {
    const idx = await buildIndex(fixtureWithVersions(['1.9.0', '1.10.0', '1.2.0']));
    expect(idx.courses[0]?.latest).toBe('1.10.0');
  });

  it('versions liệt kê tăng dần theo semver', async () => {
    const idx = await buildIndex(fixtureWithVersions(['1.9.0', '1.10.0', '1.2.0']));
    expect(idx.courses[0]?.versions).toEqual(['1.2.0', '1.9.0', '1.10.0']);
  });

  it('bản tiền phát hành đứng TRƯỚC bản chính thức cùng số', async () => {
    const idx = await buildIndex(fixtureWithVersions(['1.0.0', '1.0.0-rc.1', '1.0.0-rc.2']));
    expect(idx.courses[0]?.versions).toEqual(['1.0.0-rc.1', '1.0.0-rc.2', '1.0.0']);
    expect(idx.courses[0]?.latest).toBe('1.0.0');
  });

  it('compareSemver: chuỗi so sánh trực tiếp, để cái sai lộ ra ở đây chứ không ở index', () => {
    expect(compareSemver('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareSemver('1.9.0', '1.10.0')).toBeLessThan(0);
    expect(compareSemver('2.0.0', '10.0.0')).toBeLessThan(0);
    expect(compareSemver('1.0.0-rc.1', '1.0.0')).toBeLessThan(0);
    expect(compareSemver('1.0.0-rc.2', '1.0.0-rc.10')).toBeLessThan(0);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    // Build metadata is ignored for precedence (semver §10).
    expect(compareSemver('1.0.0+a', '1.0.0+b')).toBe(0);
  });
});

describe('index.json tự mô tả phiên bản định dạng', () => {
  it('mang schema: 1 — nền tảng cũ gặp index mới phải hỏng ồn ào, không đoán', async () => {
    const idx = await buildIndex(fixtureWithVersions(['1.0.0']));
    expect(idx.schema).toBe(1);
    expect(INDEX_SCHEMA).toBe(1);
  });
});

describe('chốt chống cổng mù', () => {
  it('root rỗng → EmptyRegistryError, KHÔNG phải một index rỗng ghi đè lên index thật', async () => {
    await expect(buildIndex(tmproot())).rejects.toBeInstanceOf(EmptyRegistryError);
  });

  it('root không tồn tại → EmptyRegistryError', async () => {
    await expect(buildIndex(join(tmproot(), 'khong-co'))).rejects.toBeInstanceOf(EmptyRegistryError);
  });

  it('một course không có phiên bản nào đọc được → NÉM, không lặng lẽ bỏ khỏi index', async () => {
    const root = tmproot();
    mkdirSync(join(root, 'course-rong'), { recursive: true });
    await expect(buildIndex(root)).rejects.toThrow(/course-rong/);
  });
});

describe('index từ hai gói mẫu THẬT đã commit', () => {
  /**
   * Was: "cả hai course có mặt, nhãn hạng và ngôn ngữ lấy từ manifest",
   * building the index straight from `FIXTURE_COURSES` and reading `tier` off
   * both. Format v2 (task 1 of the server-side pivot) removed `tier`
   * entirely, and running the content rules unconditionally now catches
   * `so-dau-phay-dong`'s 19.7 KB `viz.js` — a real, tracked, single-cause red
   * (`JS_FILE_IN_PACKAGE`) that needs that course's interactive part rewritten
   * as a widget, real content work for a later task. `buildIndex` refuses to
   * emit ANY index while one course in the tree has findings, so this is now
   * pinned as a rejection rather than a success — see `validate-pr.test.ts`
   * for the same fixture pinned the same way.
   */
  it('trên bytes THẬT: đúng MỘT lỗi đã biết (viz.js chưa thành widget) — không sinh index', async () => {
    await expect(buildIndex(FIXTURE_COURSES)).rejects.toMatchObject({
      findings: [{ code: 'JS_FILE_IN_PACKAGE', path: 'viz.js' }],
    });
  });

  /**
   * The field-level coverage the test above used to carry for BOTH sample
   * courses now only holds for the one that is clean. Copied into a fresh
   * temp root rather than read from `FIXTURE_COURSES` directly: `buildIndex`
   * walks every course under `root`, and the other real sample is the known
   * red above.
   */
  it('trên bytes THẬT (gói content): mọi trường màn hình đọc khớp manifest', async () => {
    const root = tmproot();
    cpSync(join(FIXTURE_COURSES, 'bat-bien-vong-lap'), join(root, 'bat-bien-vong-lap'), { recursive: true });

    const idx = await buildIndex(root);
    const content = idx.courses.find((c) => c.id === 'bat-bien-vong-lap');

    expect(content?.lang).toBe('vi');
    expect(content?.latest).toBe('1.0.0');
    expect(content?.versions).toEqual(['1.0.0']);
    expect(content?.license).toBe('CC-BY-4.0');
    expect(content?.generatedBy).toBe('ai');
    expect(content?.authors.map((a) => a.name)).toEqual(['tuhoc course-authoring skill']);
    expect(content?.bytes).toBeGreaterThan(0);
  });

  it('gói KHÔNG hợp lệ không bao giờ lọt vào index — index và cổng PR dùng CÙNG bộ luật', async () => {
    const root = tmproot();
    const dir = join(root, 'gia-mao');
    writeCourse(dir, 'gia-mao', '1.0.0');
    writeFileSync(join(dir, 'chapters', 'c1.html'), '<script>alert(1)</script>');

    await expect(buildIndex(root)).rejects.toThrow(/SCRIPT_TAG/);
  });

  it('mọi nguồn thời gian tiêm được, nên index cùng một commit ra byte-for-byte giống nhau', async () => {
    // Why this matters and is not tidiness: the platform caches `index.json` by
    // `ETag`. An index that changes on every rebuild of the same commit busts
    // that cache for no reason, and makes "did the catalog actually change?"
    // unanswerable from a diff. Both time sources are injected; the workflow
    // passes the COMMIT date for both.
    const root = fixtureWithVersions(['1.0.0']);
    const clocks = { updatedAt: async () => '2026-08-22T00:00:00.000Z', generatedAt: () => '2026-08-22T00:00:00.000Z' };
    const a = await buildIndex(root, clocks);
    const b = await buildIndex(root, clocks);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.courses[0]?.updatedAt).toBe('2026-08-22T00:00:00.000Z');
  });

  it('KHÔNG tiêm đồng hồ thì index KHÔNG ổn định — phép đo cho biết vì sao workflow phải tiêm', async () => {
    const root = fixtureWithVersions(['1.0.0']);
    const a = await buildIndex(root);
    await new Promise((r) => setTimeout(r, 2));
    const b = await buildIndex(root);
    expect(a.generatedAt).not.toBe(b.generatedAt);
  });
});
