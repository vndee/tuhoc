/**
 * `index.json` — one file, one request.
 *
 * The load-bearing test here is the SEMVER one. This project has walked into
 * lexicographic version ordering **twice** already (once on the Go side, once
 * in `scripts/course_workspace.py`, whose comment at line 173 names the trap by
 * hand: *"1.10.0 đứng TRƯỚC 1.9.0"*). It walks into it a third time the moment
 * somebody writes `versions.sort()` and it looks right on `1.0.0 … 1.9.0`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

function writeCourse(dir: string, id: string, version: string, tier: 'content' | 'interactive' = 'content'): void {
  mkdirSync(join(dir, 'chapters'), { recursive: true });
  const manifest = {
    id,
    title: 'Gói thử',
    description: 'Gói dùng cho test index',
    lang: 'vi',
    version,
    runtime: '^1',
    tier,
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
  it('cả hai course có mặt, nhãn hạng và ngôn ngữ lấy từ manifest', async () => {
    const idx = await buildIndex(FIXTURE_COURSES);

    expect(idx.courses.map((c) => c.id)).toEqual(['bat-bien-vong-lap', 'so-dau-phay-dong']);

    const interactive = idx.courses.find((c) => c.id === 'so-dau-phay-dong');
    expect(interactive?.tier).toBe('interactive');
    expect(interactive?.lang).toBe('vi');
    expect(interactive?.latest).toBe('1.0.0');
    expect(interactive?.versions).toEqual(['1.0.0']);
    expect(interactive?.license).toBe('CC-BY-4.0');
    expect(interactive?.generatedBy).toBe('ai');
    expect(interactive?.authors.map((a) => a.name)).toEqual(['tuhoc course-authoring skill']);
    // bytes is the DECODED size of the package, the same axis the rule set
    // budgets — the sample really does ship ~200 KB of chapters.
    expect(interactive?.bytes).toBeGreaterThan(100_000);

    const content = idx.courses.find((c) => c.id === 'bat-bien-vong-lap');
    expect(content?.tier).toBe('content');
  });

  it('gói KHÔNG hợp lệ không bao giờ lọt vào index — index và cổng PR dùng CÙNG bộ luật', async () => {
    const root = tmproot();
    const dir = join(root, 'gia-mao');
    writeCourse(dir, 'gia-mao', '1.0.0', 'content');
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
