/**
 * Tests for the packaging CLI — `tuhoc init` and `tuhoc pack`.
 *
 * These drive the REAL binary through a subprocess (`bun src/index.ts …`) and
 * read back the real exit code and the real stderr, because that is the whole
 * surface a contributor sees. An in-process harness would test the functions
 * and leave the `process.exit` plumbing — the part that decides whether CI and
 * a shell `&&` behave — completely unpinned.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir as osTmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { FINDING_CODES, validatePackage } from './course-format.ts';
import { FIX_HINTS } from './findings.ts';
import { readPackageDir } from './readdir.ts';

const CLI = fileURLToPath(new URL('./index.ts', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const cleanup: string[] = [];
afterAll(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], cwd: string): Run {
  const r = spawnSync('bun', [CLI, ...args], { cwd, encoding: 'utf8' });
  if (r.error) throw r.error;
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

async function tmpdir(): Promise<string> {
  const dir = mkdtempSync(join(osTmpdir(), 'tuhoc-cli-'));
  cleanup.push(dir);
  return dir;
}

async function runPack(args: string[], cwd?: string): Promise<Run> {
  return run(['pack', ...args], cwd ?? (await tmpdir()));
}

async function runInit(args: string[], cwd?: string): Promise<Run> {
  return run(['init', ...args], cwd ?? (await tmpdir()));
}

/** A manifest that satisfies every v2 rule, so a test only has to break the one thing it is about. */
function fixtureManifest(): unknown {
  return {
    id: 'fixture-course',
    title: 'Course thử',
    description: 'Gói dùng cho test',
    lang: 'vi',
    version: '1.0.0',
    runtime: '^1',
    tier: 'content',
    license: 'CC-BY-4.0',
    authors: [{ name: 'Người thử' }],
    generatedBy: 'human',
    parts: [
      {
        title: 'Phần 1',
        chapters: [{ id: 'c1', num: '1.1', title: 'Chương một', short: 'Chương một', file: 'chapters/c1.html' }],
      },
    ],
  };
}

/**
 * Writes a VALID course directory, then applies `extra` on top — so a test that
 * wants one broken file writes exactly that one file and nothing else.
 * A key in `extra` may also be `manifest.json`.
 */
async function makeFixtureCourse(extra: Record<string, string> = {}): Promise<string> {
  const dir = await tmpdir();
  const files: Record<string, string> = {
    'manifest.json': JSON.stringify(fixtureManifest(), null, 2),
    'chapters/c1.html': '<h1>Chương một</h1>\n<p>Nội dung.</p>\n',
    ...extra,
  };
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

// ---------------------------------------------------------------------------
// The three cases named in the task brief.
// ---------------------------------------------------------------------------

describe('tuhoc pack', () => {
  it('pack một thư mục hợp lệ ra zip và thoát 0', async () => {
    const dir = await makeFixtureCourse();
    const res = await runPack([dir, '-o', join(dir, 'out.zip')]);
    expect(res.code).toBe(0);
    expect(existsSync(join(dir, 'out.zip'))).toBe(true);
  });

  it('pack thư mục có <script> trong hạng content: thoát 1 và IN RA code luật', async () => {
    const dir = await makeFixtureCourse({ 'chapters/c1.html': '<script>x</script>' });
    const res = await runPack([dir]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('SCRIPT_TAG');
    expect(res.stderr).toContain('chapters/c1.html'); // phải nói RÕ tệp nào
  });
});

describe('tuhoc init', () => {
  it('init rồi pack ngay phải thành công — khung mẫu tự nó hợp lệ', async () => {
    const dir = await tmpdir();
    expect((await runInit([dir])).code).toBe(0);
    expect((await runPack([dir])).code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The error report is the product here, so it gets pinned like one.
// ---------------------------------------------------------------------------

describe('báo lỗi của pack', () => {
  it('in MỌI finding, không chỉ cái đầu tiên, mỗi cái kèm path và detail', async () => {
    // Two independent problems, in two different files, under two codes.
    const dir = await makeFixtureCourse({
      'chapters/c1.html': '<p onclick="x()">a</p>',
      'extra.html': '<iframe src="a"></iframe>',
    });
    const res = await runPack([dir]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('EVENT_HANDLER_ATTR');
    expect(res.stderr).toContain('chapters/c1.html');
    expect(res.stderr).toContain('EMBEDDED_FRAME');
    expect(res.stderr).toContain('extra.html');
  });

  it('mỗi finding có một dòng "Cách sửa" nói làm gì tiếp theo', async () => {
    const dir = await makeFixtureCourse({ 'chapters/c1.html': '<script>x</script>' });
    const res = await runPack([dir]);
    expect(res.stderr).toContain('Cách sửa');
    // The hint for SCRIPT_TAG has to name the way out, not just restate the rule.
    expect(res.stderr).toContain('interactive');
  });

  it('giữ nguyên "detail" mà bộ luật trả về — không nuốt', async () => {
    const dir = await makeFixtureCourse({ 'manifest.json': '{ not json' });
    const res = await runPack([dir]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('MANIFEST_PARSE');
    expect(res.stderr).toContain('invalid JSON');
  });

  it('trỏ đúng trường của manifest bằng JSON pointer', async () => {
    const broken = { ...(fixtureManifest() as Record<string, unknown>) };
    delete broken['license'];
    const dir = await makeFixtureCourse({ 'manifest.json': JSON.stringify(broken) });
    const res = await runPack([dir]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('MANIFEST_FIELD');
    expect(res.stderr).toContain('manifest.json#/license');
  });

  it('không ghi zip khi gói không hợp lệ', async () => {
    const dir = await makeFixtureCourse({ 'chapters/c1.html': '<script>x</script>' });
    const out = join(dir, 'out.zip');
    expect((await runPack([dir, '-o', out])).code).toBe(1);
    expect(existsSync(out)).toBe(false);
  });

  it('gợi ý dài in MỘT lần cho mỗi mã, các lần sau trỏ ngược lại', async () => {
    // Four MANIFEST_FIELD findings at once is the common case, not the corner
    // one — it is what a v1 manifest does. Printing the whole hint four times
    // is how a report becomes a wall nobody reads.
    const broken = { ...(fixtureManifest() as Record<string, unknown>) };
    for (const key of ['license', 'tier', 'generatedBy', 'authors']) delete broken[key];
    const dir = await makeFixtureCourse({ 'manifest.json': JSON.stringify(broken) });
    const res = await runPack([dir]);
    expect(res.code).toBe(1);
    // All four locations still named in full.
    for (const key of ['license', 'tier', 'generatedBy', 'authors']) {
      expect(res.stderr).toContain(`manifest.json#/${key}`);
    }
    // …but the hint body appears exactly once.
    const hintBody = 'Bốn trường v2 hay thiếu nhất';
    expect(res.stderr.split(hintBody).length - 1).toBe(1);
    expect(res.stderr).toContain('như mục 1) ở trên');
  });

  it('MỌI mã trong FINDING_CODES đều có gợi ý sửa — không mã nào rơi ra trần trụi', () => {
    // This is the drift alarm: when the rule set grows a code, this goes red
    // instead of the CLI quietly printing a bare code at a contributor.
    const missing = FINDING_CODES.filter((code) => !(code in FIX_HINTS));
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Filesystem → package Map. Questions `validatePackage` cannot answer because
// it never sees a filesystem.
// ---------------------------------------------------------------------------

describe('đọc thư mục thành gói', () => {
  it('thư mục không tồn tại: thoát 1 và nói rõ đường dẫn', async () => {
    const dir = await tmpdir();
    const missing = join(dir, 'khong-co');
    const res = await runPack([missing]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain(missing);
  });

  it('từ chối symlink thay vì đóng gói thứ nó trỏ tới', async () => {
    const dir = await makeFixtureCourse();
    const outside = await tmpdir();
    writeFileSync(join(outside, 'secret.txt'), 'bí mật');
    symlinkSync(join(outside, 'secret.txt'), join(dir, 'link.txt'));
    const res = await runPack([dir]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('link.txt');
    expect(res.stderr.toLowerCase()).toContain('symlink');
  });

  it('bỏ qua mục ẩn và nói ra là đã bỏ qua', async () => {
    const dir = await makeFixtureCourse();
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(join(dir, '.git', 'config'), 'rác');
    writeFileSync(join(dir, '.DS_Store'), 'rác');
    const res = await runPack([dir, '-o', join(dir, 'out.zip')]);
    expect(res.code).toBe(0);
    const packed = await readPackageDir(dir, join(dir, 'out.zip'));
    expect([...packed.files.keys()].some((p) => p.startsWith('.'))).toBe(false);
    expect(res.stdout).toContain('bỏ qua');
  });

  it('không tự đóng gói chính tệp zip nó sắp ghi', async () => {
    const dir = await makeFixtureCourse();
    const out = join(dir, 'out.zip');
    expect((await runPack([dir, '-o', out])).code).toBe(0);
    // Second pack, with out.zip now sitting inside the source directory.
    expect((await runPack([dir, '-o', out])).code).toBe(0);
    const { files } = await readPackageDir(dir, out);
    expect(files.has('out.zip')).toBe(false);
  });

  it('dùng dấu / cho đường dẫn trong gói, khớp với manifest', async () => {
    const dir = await makeFixtureCourse();
    const { files } = await readPackageDir(dir, null);
    expect([...files.keys()].sort()).toEqual(['chapters/c1.html', 'manifest.json']);
  });
});

// ---------------------------------------------------------------------------
// `init`
// ---------------------------------------------------------------------------

describe('khung mẫu của init', () => {
  it('manifest mẫu có đủ bốn trường v2 và mặc định tier "content"', async () => {
    const dir = await tmpdir();
    expect((await runInit([dir])).code).toBe(0);
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    expect(manifest['tier']).toBe('content'); // hạng an toàn là mặc định
    expect(manifest['license']).toBeTypeOf('string');
    expect(manifest['generatedBy']).toBeTypeOf('string');
    expect(Array.isArray(manifest['authors'])).toBe(true);
  });

  it('lấy id từ tên thư mục', async () => {
    const parent = await tmpdir();
    const dir = join(parent, 'Course Của Tôi');
    expect((await runInit([dir])).code).toBe(0);
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    expect(manifest['id']).toBe('course-cua-toi');
  });

  it('README mẫu trỏ tới docs/course-format.md', async () => {
    const dir = await tmpdir();
    await runInit([dir]);
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('docs/course-format.md');
  });

  it('từ chối ghi đè tệp đã có, và không sửa gì cả', async () => {
    const dir = await tmpdir();
    writeFileSync(join(dir, 'manifest.json'), 'CỦA TÔI');
    const res = await runInit([dir]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('manifest.json');
    expect(readFileSync(join(dir, 'manifest.json'), 'utf8')).toBe('CỦA TÔI');
    expect(existsSync(join(dir, 'README.md'))).toBe(false);
  });

  it('tên thư mục thù địch vẫn cho ra khung mẫu HỢP LỆ', async () => {
    // `{{title}}` is substituted into both JSON and HTML. A directory name is
    // attacker-adjacent input at worst and a typo at best; either way the
    // scaffold it produces still has to pass its own gate.
    const parent = await tmpdir();
    const dir = join(parent, '<script>a" \\ b</script>');
    expect((await runInit([dir])).code).toBe(0);
    expect((await runPack([dir])).code).toBe(0);
  });

  it('tạo thư mục nếu chưa có', async () => {
    const parent = await tmpdir();
    const dir = join(parent, 'moi', 'sau');
    expect((await runInit([dir])).code).toBe(0);
    expect(existsSync(join(dir, 'manifest.json'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

describe('mặt tiền dòng lệnh', () => {
  it('không tham số: in cách dùng ra stderr và thoát 1', async () => {
    const res = run([], await tmpdir());
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('tuhoc init');
    expect(res.stderr).toContain('tuhoc pack');
  });

  it('--help: in cách dùng ra stdout và thoát 0', async () => {
    const res = run(['--help'], await tmpdir());
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('tuhoc pack');
  });

  it('lệnh con lạ: thoát 1 và nhắc lại tên lệnh sai', async () => {
    const res = run(['bogus'], await tmpdir());
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('bogus');
  });
});

// ---------------------------------------------------------------------------
// The real package. Deliberately does NOT hard-code a verdict: at the time of
// writing `courses/***REMOVED***` is still a v1 manifest and fails on the
// four new fields, and task 11 adds them. What must hold either way is that the
// CLI's exit code is the RULE SET's verdict — that is the wire this task exists
// to connect, and it stays pinned across task 11.
// ---------------------------------------------------------------------------

describe('gói thật courses/***REMOVED***', () => {
  it('mã thoát của CLI = phán quyết của validatePackage, không phải luật thứ hai', async () => {
    const real = join(REPO_ROOT, 'courses', '***REMOVED***');
    const { files } = await readPackageDir(real, null);
    const expected = validatePackage(files).ok ? 0 : 1;
    const res = await runPack([real]);
    expect(res.code).toBe(expected);
  });
});
