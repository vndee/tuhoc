/**
 * The load-bearing claim of the registry gate, in test form.
 *
 * Not *"CI runs"* — that is the assertion that stays green while nothing is
 * checked. The claim here is **"the bad thing is refused"**, plus the control
 * case without which a validator that refuses everything would also be green.
 *
 * ## Where this deviates from the plan, and why
 *
 * The plan's sketch asserts `code === 'SCRIPT_IN_CONTENT'` and reads
 * `finding.where`. Neither exists. Measured against
 * `packages/course-format/src/validate.ts`:
 *
 *   - the code for a `<script>` in a `content`-tier package is **`SCRIPT_TAG`**
 *     (`FINDING_CODES`, validate.ts:100-121);
 *   - the field naming the offending file is **`path`** (`Finding`,
 *     validate.ts:85-89).
 *
 * Inventing `SCRIPT_IN_CONTENT`/`where` here would put a second vocabulary for
 * the same facts in front of the same contributor — the small version of the
 * measured *"one rule set, three copies, disagreeing on 7 of 12 rows"*. The
 * tests below use the rule set's own words.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir as osTmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { changedCourseDirs, validateChangedCourses } from './validate-pr.ts';
import { courseDirsUnder, EmptyRegistryError, NothingScannedError } from './tree.ts';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const FIXTURE_COURSES = join(REPO_ROOT, 'fixtures', 'courses');

const cleanup: string[] = [];
afterAll(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function tmproot(): string {
  const dir = mkdtempSync(join(osTmpdir(), 'tuhoc-registry-'));
  cleanup.push(dir);
  return dir;
}

interface Fixture {
  tier: 'content' | 'interactive';
  files: Record<string, string>;
  /** Course id, which is also the directory name. */
  id?: string;
  version?: string;
  /** Chapters to declare. Defaults to one chapter per `chapters/*.html` file. */
  chapters?: { id: string; file: string }[];
  /** Where to put the course directory. Defaults to a fresh temp root. */
  root?: string;
}

/** Writes a course directory on disk and returns its path. */
function writeFixture(spec: Fixture): string {
  const root = spec.root ?? tmproot();
  const id = spec.id ?? 'fixture-course';
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });

  const chapters =
    spec.chapters ??
    Object.keys(spec.files)
      .filter((f) => f.endsWith('.html'))
      .map((file, i) => ({ id: `c${i + 1}`, file }));

  const manifest = {
    id,
    title: 'Gói thử',
    description: 'Gói dùng cho test cổng registry',
    lang: 'vi',
    version: spec.version ?? '1.0.0',
    runtime: '^1',
    tier: spec.tier,
    license: 'CC-BY-4.0',
    authors: [{ name: 'test' }],
    generatedBy: 'human',
    parts: [
      {
        title: 'Phần I',
        chapters: chapters.map((c) => ({ id: c.id, num: '1.1', title: 'Chương', short: 'Chương', file: c.file })),
      },
    ],
  };

  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  for (const [rel, body] of Object.entries(spec.files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return dir;
}

describe('validateChangedCourses — the bad thing is refused', () => {
  it('gói hạng content mang <script> bị từ chối, và thông báo nêu ĐÍCH DANH tệp', async () => {
    const dir = writeFixture({ tier: 'content', files: { 'chapters/c1.html': '<script>alert(1)</script>' } });

    const findings = await validateChangedCourses([dir]);

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.map((f) => f.code)).toContain('SCRIPT_TAG');
    expect(findings.map((f) => f.path).join(' ')).toContain('chapters/c1.html');
    // The renderer must name the file too, not only the structured finding:
    // a CI log is read as text.
    expect(findings.map((f) => `${f.courseDir} ${f.path} ${f.detail}`).join('\n')).toContain('chapters/c1.html');
  });

  it('ĐỐI CHỨNG: cùng gói ấy khai tier "interactive" thì ĐƯỢC — hạng đó được phép chạy mã', async () => {
    const dir = writeFixture({ tier: 'interactive', files: { 'chapters/c1.html': '<script>alert(1)</script>' } });

    expect(await validateChangedCourses([dir])).toEqual([]);
  });

  it('ĐỐI CHỨNG trên bytes THẬT: gói mẫu interactive đã commit (ships viz.js) đi qua sạch', async () => {
    expect(await validateChangedCourses([join(FIXTURE_COURSES, 'so-dau-phay-dong')])).toEqual([]);
  });

  it('ĐỐI CHỨNG trên bytes THẬT: gói mẫu content đã commit đi qua sạch', async () => {
    expect(await validateChangedCourses([join(FIXTURE_COURSES, 'bat-bien-vong-lap')])).toEqual([]);
  });

  it('cùng gói ấy hạng content mà kèm một tệp .js thì bị từ chối', async () => {
    const dir = writeFixture({
      tier: 'content',
      files: { 'chapters/c1.html': '<p>an toàn</p>', 'viz.js': 'console.log(1)' },
      chapters: [{ id: 'c1', file: 'chapters/c1.html' }],
    });

    const findings = await validateChangedCourses([dir]);
    expect(findings.map((f) => f.code)).toContain('JS_FILE_IN_PACKAGE');
  });

  it('mỗi thư mục hỏng đều được nêu tên — hai gói xấu cho hai nhóm finding', async () => {
    const root = tmproot();
    const a = writeFixture({ root, id: 'a', tier: 'content', files: { 'chapters/c1.html': '<script>x</script>' } });
    const b = writeFixture({ root, id: 'b', tier: 'content', files: { 'chapters/c1.html': '<iframe src=x>' } });

    const findings = await validateChangedCourses([a, b]);
    expect(new Set(findings.map((f) => f.courseDir))).toEqual(new Set([a, b]));
  });
});

describe('validateChangedCourses — the questions the rule set structurally cannot be asked', () => {
  it('thư mục không tồn tại → finding, không ném ngoại lệ trần', async () => {
    const findings = await validateChangedCourses([join(tmproot(), 'khong-co')]);
    expect(findings.map((f) => f.code)).toContain('REGISTRY_UNREADABLE_DIR');
  });

  it('symlink trong gói → finding, không phải một exception làm đỏ job vì lý do khác', async () => {
    const dir = writeFixture({ tier: 'content', files: { 'chapters/c1.html': '<p>ok</p>' } });
    symlinkSync('/etc/passwd', join(dir, 'link.html'));

    const findings = await validateChangedCourses([dir]);
    expect(findings.map((f) => f.code)).toContain('REGISTRY_UNPACKABLE_ENTRY');
    expect(findings.map((f) => f.path)).toContain('link.html');
  });

  it('tên thư mục khác manifest.id → finding (câu hỏi về BỐ CỤC registry, validatePackage không thấy được)', async () => {
    const root = tmproot();
    const dir = writeFixture({ root, id: 'ten-thu-muc', tier: 'content', files: { 'chapters/c1.html': '<p>ok</p>' } });
    // Rewrite just the id so the manifest disagrees with the directory it sits in.
    const manifestPath = join(dir, 'manifest.json');
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    raw['id'] = 'id-khac';
    writeFileSync(manifestPath, JSON.stringify(raw));

    const findings = await validateChangedCourses([dir]);
    expect(findings.map((f) => f.code)).toContain('REGISTRY_ID_MISMATCH');
  });
});

describe('chốt chống cổng mù', () => {
  it('quét 0 thư mục course thì NÉM, không trả [] — "[] nghĩa là đạt" là đúng cái bẫy', async () => {
    await expect(validateChangedCourses([])).rejects.toBeInstanceOf(NothingScannedError);
  });

  it('registry root không tồn tại → EmptyRegistryError, không phải danh sách rỗng', async () => {
    await expect(courseDirsUnder(join(tmproot(), 'khong-co'))).rejects.toBeInstanceOf(EmptyRegistryError);
  });

  it('registry root tồn tại nhưng không có thư mục course nào → EmptyRegistryError', async () => {
    const root = tmproot();
    writeFileSync(join(root, 'README.md'), '# trống');
    await expect(courseDirsUnder(root)).rejects.toBeInstanceOf(EmptyRegistryError);
  });

  it('registry root thật (fixtures/courses) có đúng hai thư mục course, .zip không tính', async () => {
    const dirs = await courseDirsUnder(FIXTURE_COURSES);
    expect(dirs.map((d) => d.split('/').pop())).toEqual(['bat-bien-vong-lap', 'so-dau-phay-dong']);
  });
});

describe('changedCourseDirs — tệp PR đổi → thư mục course', () => {
  const root = 'fixtures/courses';

  it('gộp nhiều tệp trong cùng course thành một thư mục, và sắp ổn định', () => {
    expect(
      changedCourseDirs(
        [
          'fixtures/courses/so-dau-phay-dong/chapters/p0-1.html',
          'fixtures/courses/so-dau-phay-dong/manifest.json',
          'fixtures/courses/bat-bien-vong-lap/manifest.json',
        ],
        root,
      ),
    ).toEqual(['fixtures/courses/bat-bien-vong-lap', 'fixtures/courses/so-dau-phay-dong']);
  });

  it('bỏ qua tệp ngoài registry root', () => {
    expect(changedCourseDirs(['apps/web/src/App.tsx', 'Makefile'], root)).toEqual([]);
  });

  it('bỏ qua tệp nằm THẲNG trong root (README của registry không phải course)', () => {
    expect(changedCourseDirs(['fixtures/courses/README.md'], root)).toEqual([]);
  });

  it('KHÔNG bị đánh lừa bởi một root là tiền tố chuỗi của thư mục khác', () => {
    expect(changedCourseDirs(['fixtures/courses-cu/x/manifest.json'], root)).toEqual([]);
  });

  it('tệp bị xoá vẫn cho ra thư mục — thư mục có thể đã biến mất, và đó là một finding chứ không phải im lặng', () => {
    expect(changedCourseDirs(['fixtures/courses/da-xoa/manifest.json'], root)).toEqual(['fixtures/courses/da-xoa']);
  });
});
