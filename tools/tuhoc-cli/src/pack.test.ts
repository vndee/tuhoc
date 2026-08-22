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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir as osTmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { FINDING_CODES, validatePackage } from './course-format.ts';
import { FIX_HINTS } from './findings.ts';
import { readPackageDir } from './readdir.ts';

const CLI = fileURLToPath(new URL('./index.ts', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * What the CLI must call itself when it is run from the repo root — the cwd a
 * contributor is actually in, and the one `docs/course-format.md` writes its
 * examples for. There is no installed `tuhoc` executable anywhere in this repo
 * (no workspaces, no link step), so any line telling a contributor to type
 * `tuhoc pack …` is a line that exits 127 when they do.
 */
const SELF_FROM_ROOT = 'bun tools/tuhoc-cli/src/index.ts';

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
// Every command line this CLI tells a contributor to type has to be a command
// line that RUNS. The first one it prints is the last step of the first command
// they ever run, so getting it wrong ends the session right there.
// ---------------------------------------------------------------------------

describe('lệnh mà CLI bảo người dùng gõ', () => {
  // Two names: the tidy one, and one with a space in it — because people name
  // course directories in Vietnamese and an unquoted path in a printed command
  // is a command that means something else.
  for (const name of ['khoa-hoc-cua-toi', 'Course Của Tôi']) {
    it(`dán thẳng dòng lệnh init in ra vào shell thì nó CHẠY: ${JSON.stringify(name)}`, async () => {
      const parent = await tmpdir();
      const res = await runInit([name], parent);
      expect(res.code).toBe(0);

      // The literal characters between backticks — what a contributor copies.
      const printed = /Chạy `([^`]+)`/.exec(res.stdout);
      expect(printed).not.toBeNull();
      const line = printed![1] as string;

      // A REAL shell, from the SAME cwd, because "copy, paste, it runs" is the
      // claim being made. Running it through an argv list would prove nothing
      // about a name only a $PATH lookup can fail to find, nor about quoting.
      const pasted = spawnSync('/bin/sh', ['-c', line], { cwd: parent, encoding: 'utf8' });
      expect({ line, code: pasted.status, err: pasted.stderr }).toMatchObject({ code: 0 });
      expect(pasted.stdout).toContain('OK');
    });
  }

  it('khối "Cách dùng" nêu lệnh có thật khi chạy từ gốc repo', async () => {
    const res = run(['--help'], REPO_ROOT);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(`${SELF_FROM_ROOT} init `);
    expect(res.stdout).toContain(`${SELF_FROM_ROOT} pack `);
  });

  it('gợi ý của EMPTY_PACKAGE trỏ tới lệnh init có thật', async () => {
    const empty = await tmpdir();
    const res = await runPack([empty], REPO_ROOT);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('EMPTY_PACKAGE');
    expect(res.stderr).toContain(`${SELF_FROM_ROOT} init `);
  });

  it('README của khung mẫu nhắc lại ĐÚNG dòng lệnh init vừa in ra', async () => {
    // The contributor reads the README minutes or days after the terminal
    // scrollback is gone. If the two disagree, the durable one is the one that
    // has to be right — so they are the same string.
    const parent = await tmpdir();
    const res = await runInit(['khoa-hoc-cua-toi'], parent);
    expect(res.code).toBe(0);
    const line = (/Chạy `([^`]+)`/.exec(res.stdout)?.[1] ?? '') as string;
    expect(line).not.toBe('');
    expect(readFileSync(join(parent, 'khoa-hoc-cua-toi', 'README.md'), 'utf8')).toContain(line);
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

  // The self-exclusion above only ever covers THIS run's output path. A zip
  // left behind by a previous run under any other name is ordinary content:
  // it gets packed, the package is still valid, and the only signal is a file
  // count nobody reads. Left silent, a course grows one zip per pack until it
  // hits the 20 MB ceiling for a reason its author cannot possibly guess.
  it('nói ra khi một tệp .zip có sẵn đang bị đóng vào gói', async () => {
    const dir = await makeFixtureCourse();
    writeFileSync(join(dir, 'lan-truoc.zip'), 'PK rác');
    const out = join(await tmpdir(), 'lan-nay.zip');
    const res = await runPack([dir, '-o', out]);
    expect(res.code).toBe(0);
    // It really is in there — that is the fact being reported, not a guess.
    const { files } = await readPackageDir(dir, out);
    expect(files.has('lan-truoc.zip')).toBe(true);
    expect(res.stdout).toContain('đang chứa');
    expect(res.stdout).toContain('lan-truoc.zip');
  });

  it('không nói gì về .zip khi trong thư mục không có tệp .zip nào', async () => {
    const dir = await makeFixtureCourse();
    const res = await runPack([dir, '-o', join(await tmpdir(), 'x.zip')]);
    expect(res.code).toBe(0);
    expect(res.stdout).not.toContain('đang chứa');
  });

  it('khi pack thất bại, thông báo bỏ qua mục ẩn được lặp sang stderr', async () => {
    // Here the skipped entry IS the cause of the failure, and stderr is the
    // half a CI log keeps. Splitting cause from effect across two streams
    // leaves whoever reads the log with an impossible finding.
    const manifest = fixtureManifest() as { parts: { chapters: { file: string }[] }[] };
    manifest.parts[0].chapters[0].file = 'chapters/.an.html';
    const dir = await makeFixtureCourse({
      'manifest.json': JSON.stringify(manifest),
      'chapters/.an.html': '<p>bị bỏ qua vì tên bắt đầu bằng dấu chấm</p>',
    });
    const res = await runPack([dir]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('CHAPTER_FILE_MISSING');
    expect(res.stderr).toContain('bỏ qua');
    expect(res.stderr).toContain('chapters/.an.html');
  });

  it('tên tệp "__proto__": thoát 1, không ghi zip, và nói phải làm gì', async () => {
    const dir = await makeFixtureCourse();
    writeFileSync(join(dir, '__proto__'), 'ghi chú');
    const out = join(await tmpdir(), 'proto.zip');
    const res = await runPack([dir, '-o', out]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('__proto__');
    expect(res.stderr).toContain('Cách sửa');
    expect(existsSync(out)).toBe(false);
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

  // `{{title}}` is substituted into both JSON and HTML. A directory name is
  // attacker-adjacent input at worst and a typo at best; either way the
  // scaffold it produces still has to pass its own gate.
  //
  // The names below deliberately contain NO `/`. A name like `<script>a</script>`
  // never reaches the filter at all: the `/` in the closing tag is a path
  // separator, so `join(parent, name)` makes nested directories and
  // `basename()` — the only thing `displayTitle` ever sees — is the harmless
  // tail `script>`. A test built on such a name passes whether the filter
  // exists or not, which is the same as not having a test.
  const HOSTILE_NAMES = [
    '<img onerror=alert(1)>', // breaks the HTML the README is scanned as
    'a" , "id": "x', //          breaks the JSON of manifest.json
    '<script>a" \\ b</script>', // the `/`-containing original, kept as a case
  ];
  for (const name of HOSTILE_NAMES) {
    it(`tên thư mục thù địch vẫn cho ra khung mẫu HỢP LỆ: ${JSON.stringify(name)}`, async () => {
      const parent = await tmpdir();
      const dir = join(parent, name);
      expect((await runInit([dir])).code).toBe(0);
      expect((await runPack([dir])).code).toBe(0);

      // …and pin the filter itself, not just the verdict: whatever the
      // directory was called, what landed in the manifest is parseable JSON
      // whose title carries no markup.
      const raw = readFileSync(join(dir, 'manifest.json'), 'utf8');
      const title = (JSON.parse(raw) as Record<string, unknown>)['title'];
      expect(typeof title).toBe('string');
      expect(title as string).not.toMatch(/[<>&"'\\]/);
    });
  }

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
    const res = run([], REPO_ROOT);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain(`${SELF_FROM_ROOT} init `);
    expect(res.stderr).toContain(`${SELF_FROM_ROOT} pack `);
  });

  it('--help: in cách dùng ra stdout và thoát 0', async () => {
    const res = run(['--help'], REPO_ROOT);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(`${SELF_FROM_ROOT} pack `);
  });

  it('lệnh con lạ: thoát 1 và nhắc lại tên lệnh sai', async () => {
    const res = run(['bogus'], await tmpdir());
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('bogus');
  });

  it('--out là bí danh của -o, không phải tuỳ chọn lạ', async () => {
    const dir = await makeFixtureCourse();
    const out = join(await tmpdir(), 'qua-bi-danh.zip');
    const res = await runPack([dir, '--out', out]);
    expect(res.code).toBe(0);
    expect(existsSync(out)).toBe(true);
  });

  it('hai thư mục một lúc: thoát 1 và nói ra cả hai', async () => {
    const a = await makeFixtureCourse();
    const b = await makeFixtureCourse();
    const res = await runPack([a, b]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain(a);
    expect(res.stderr).toContain(b);
  });

  it('-o tạo cả nhánh thư mục cha chưa tồn tại', async () => {
    const dir = await makeFixtureCourse();
    const out = join(await tmpdir(), 'chua-co', 'sau', 'nua', 'out.zip');
    expect((await runPack([dir, '-o', out])).code).toBe(0);
    expect(existsSync(out)).toBe(true);
  });

  it('không có -o: tên zip lấy từ tên thư mục, ghi vào thư mục hiện tại', async () => {
    const dir = await makeFixtureCourse();
    const cwd = await tmpdir();
    expect((await runPack([dir], cwd)).code).toBe(0);
    expect(existsSync(join(cwd, `${basename(dir)}.zip`))).toBe(true);
  });

  it('-o trỏ vào một thư mục đã có: nói rõ -o cần đường dẫn TỆP', async () => {
    const dir = await makeFixtureCourse();
    const target = await tmpdir(); // a directory, not a file
    const res = await runPack([dir, '-o', target]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('tệp');
    expect(res.stderr).not.toContain('EISDIR');
  });

  it('dòng thành công nói số tệp, cỡ gói đúng đơn vị, và đường dẫn tuyệt đối', async () => {
    // `humanBytes` is the number a contributor reads the 20 MB ceiling against,
    // so the unit is checked against the zip that actually landed on disk
    // rather than against a hard-coded string.
    const dir = await tmpdir();
    expect((await runInit([dir])).code).toBe(0);
    const out = join(await tmpdir(), 'khung.zip');
    const res = await runPack([dir, '-o', out]);
    expect(res.code).toBe(0);
    const size = statSync(out).size;
    expect(size).toBeGreaterThan(1024);
    expect(size).toBeLessThan(1024 * 1024);
    expect(res.stdout).toContain(' KB → ');
    expect(res.stdout).toContain('3 tệp');
    expect(res.stdout).toContain(out); // absolute, not whatever was typed
  });

  it('-o tương đối: zip nằm ở thư mục hiện tại, và dòng OK nói đường dẫn tuyệt đối', async () => {
    // A relative path in a success line stops meaning anything the moment the
    // reader has cd'd somewhere else — including in a CI log.
    const dir = await makeFixtureCourse();
    const cwd = await tmpdir();
    const res = await runPack([dir, '-o', 'ra.zip'], cwd);
    expect(res.code).toBe(0);
    expect(existsSync(join(cwd, 'ra.zip'))).toBe(true);
    expect(res.stdout).toContain(join(cwd, 'ra.zip'));
  });
});

// ---------------------------------------------------------------------------
// The real package. Deliberately does NOT hard-code a verdict: what must hold
// is that the CLI's exit code is the RULE SET's verdict rather than a second
// rule set of its own — that is the wire this task exists to connect, and it
// has now stayed pinned across two changes of ngữ liệu (task 11 moved the
// private textbook out of the repo, task 13 replaced it with the public sample
// package `so-dau-phay-dong`).
//
// Reads `courses/`, the WORKING directory, not `fixtures/` — deliberately.
// `courses/` holds what `make courses` unpacked from the zip, so this measures
// the CLI against bytes that made a full round trip through pack/unpack, which
// is what a contributor's own directory actually is. Missing means red with a
// message, not skipped.
// ---------------------------------------------------------------------------

describe('gói thật courses/so-dau-phay-dong', () => {
  it('mã thoát của CLI = phán quyết của validatePackage, không phải luật thứ hai', async () => {
    const real = join(REPO_ROOT, 'courses', 'so-dau-phay-dong');
    if (!existsSync(real)) {
      throw new Error(
        `Chưa bung gói mẫu ra ${real}.\n` + 'Bung bằng `make courses` từ gốc repo — gói nằm trong repo tại fixtures/courses/.',
      );
    }
    const { files } = await readPackageDir(real, null);
    const expected = validatePackage(files).ok ? 0 : 1;
    const res = await runPack([real]);
    expect(res.code).toBe(expected);
    // Gói mẫu này là dữ liệu test của cả repo, nên "hợp lệ" không phải chuyện
    // để suy ra: nếu nó trượt bộ luật thì phép so ở trên vẫn xanh (0 === 0 hay
    // 1 === 1) trong khi mọi thứ khác dựng trên nó đã hỏng.
    expect(expected, 'gói mẫu phải đi qua bộ luật sạch — chạy `tuhoc pack` để xem findings').toBe(0);
  });
});
