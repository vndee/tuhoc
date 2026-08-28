/**
 * Tests for `tuhoc publish`.
 *
 * Unlike `pack.test.ts`, these call `publish()` directly rather than spawning
 * the real binary: the whole point of this command is what it does with
 * `fetch`, and there is no way to hand a subprocess a mocked network without
 * standing up a real server. `globalThis.fetch` is stubbed per test instead —
 * the server side (`PUT /admin/courses/:slug`) is Task 8's, not built yet, so
 * this is the only way to test the wire contract from this side of it.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir as osTmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { packZip } from './course-format.ts';
import type { Io } from './io.ts';
import { publish } from './publish.ts';

const SELF = 'bun tools/tuhoc-cli/src/index.ts';
const SERVER = 'https://tuhoc.example.com';
const TOKEN_ENV = 'TUHOC_ADMIN_TOKEN';

const cleanupDirs: string[] = [];
const savedToken = process.env[TOKEN_ENV];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of cleanupDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (savedToken === undefined) delete process.env[TOKEN_ENV];
  else process.env[TOKEN_ENV] = savedToken;
});

function makeIo(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

/** A manifest that satisfies `parseManifest` — publish never runs the full rule set locally, so it need not satisfy `validatePackage` too. */
function fixtureManifest(id: string): unknown {
  return {
    id,
    title: 'Course thử',
    description: 'Gói dùng cho test publish',
    lang: 'vi',
    version: '1.0.0',
    runtime: '^1',
    license: 'CC-BY-4.0',
    authors: [{ name: 'Người thử' }],
    generatedBy: 'human',
    parts: [
      { title: 'Phần 1', chapters: [{ id: 'c1', num: '1.1', title: 'Chương một', short: 'Chương một', file: 'chapters/c1.html' }] },
    ],
  };
}

/** Writes a real `packZip` archive to a temp file and returns its path — the same bytes `pack` itself would produce. */
function makeZipFile(id = 'fixture-course'): string {
  const dir = mkdtempSync(join(osTmpdir(), 'tuhoc-publish-'));
  cleanupDirs.push(dir);
  const files = new Map<string, Uint8Array>([
    ['manifest.json', new TextEncoder().encode(JSON.stringify(fixtureManifest(id)))],
    ['chapters/c1.html', new TextEncoder().encode('<h1>Chương một</h1>')],
  ]);
  const zipPath = join(dir, 'course.zip');
  writeFileSync(zipPath, packZip(files));
  return zipPath;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('tuhoc publish — 201', () => {
  it('in "đã publish {slug} v{version}" dùng version của SERVER, gọi đúng URL/method/header, thoát 0', async () => {
    const zipPath = makeZipFile('fixture-course');
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse(201, { slug: 'fixture-course', version: 3 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env[TOKEN_ENV] = 'secret-token';

    const { io, out, err } = makeIo();
    const code = await publish([zipPath, '--server', SERVER], io, SELF);

    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(out).toEqual(['tuhoc publish: đã publish fixture-course v3']);
    // The manifest's OWN version is "1.0.0" (fixtureManifest above) — it must
    // never appear here. The number printed is the server's publish sequence,
    // a completely different thing that happens to share a field name.
    expect(out.join('\n')).not.toContain('1.0.0');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${SERVER}/admin/courses/fixture-course`);
    expect(init.method).toBe('PUT');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer secret-token');
    expect(headers['Content-Type']).toBe('application/zip');
  });

  it('slug trong URL đến từ manifest.id trong zip, không phải tên tệp zip', async () => {
    const zipPath = makeZipFile('id-tu-manifest');
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse(201, { slug: 'id-tu-manifest', version: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env[TOKEN_ENV] = 'secret-token';

    const { io } = makeIo();
    await publish([zipPath, '--server', SERVER], io, SELF);

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${SERVER}/admin/courses/id-tu-manifest`);
  });
});

describe('tuhoc publish — 400', () => {
  it('in từng finding theo đúng dạng của pack (mã, vị trí, vấn đề, Cách sửa), thoát 1', async () => {
    const zipPath = makeZipFile('fixture-course');
    const fetchMock = vi.fn(async () =>
      jsonResponse(400, {
        findings: [{ code: 'SCRIPT_TAG', path: 'chapters/a.html', detail: 'must not contain a <script> tag' }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    process.env[TOKEN_ENV] = 'secret-token';

    const { io, err } = makeIo();
    const code = await publish([zipPath, '--server', SERVER], io, SELF);

    expect(code).toBe(1);
    const text = err.join('\n');
    expect(text).toContain('SCRIPT_TAG');
    expect(text).toContain('chapters/a.html');
    expect(text).toContain('must not contain a <script> tag');
    expect(text).toContain('Cách sửa');
    // The escape hatch this hint names is a widget, matching `pack`'s own
    // report for the identical finding code — same information, same shape.
    expect(text).toContain('widgets/');
  });

  it('không ghi gì ra "đã publish" khi bị từ chối', async () => {
    const zipPath = makeZipFile('fixture-course');
    const fetchMock = vi.fn(async () => jsonResponse(400, { findings: [] }));
    vi.stubGlobal('fetch', fetchMock);
    process.env[TOKEN_ENV] = 'secret-token';

    const { io, out } = makeIo();
    const code = await publish([zipPath, '--server', SERVER], io, SELF);

    expect(code).toBe(1);
    expect(out.join('\n')).not.toContain('đã publish');
  });
});

describe('tuhoc publish — token', () => {
  it('thiếu TUHOC_ADMIN_TOKEN: thoát 1, KHÔNG gọi fetch', async () => {
    const zipPath = makeZipFile('fixture-course');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    delete process.env[TOKEN_ENV];

    const { io, err } = makeIo();
    const code = await publish([zipPath, '--server', SERVER], io, SELF);

    expect(code).toBe(1);
    expect(err.join('\n')).toContain('TUHOC_ADMIN_TOKEN');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  for (const status of [401, 403]) {
    it(`mã ${status}: nói token sai/thiếu, KHÔNG in lại token, thoát 1`, async () => {
      const zipPath = makeZipFile('fixture-course');
      const fetchMock = vi.fn(async () => new Response('', { status }));
      vi.stubGlobal('fetch', fetchMock);
      const secret = 'toi-mat-khong-duoc-lo-ra-ngoai';
      process.env[TOKEN_ENV] = secret;

      const { io, err } = makeIo();
      const code = await publish([zipPath, '--server', SERVER], io, SELF);

      expect(code).toBe(1);
      const text = err.join('\n');
      expect(text.toLowerCase()).toContain('token');
      expect(text).not.toContain(secret);
    });
  }
});

describe('tuhoc publish — lỗi mạng', () => {
  it('fetch throw (mất kết nối): thoát 1, nói rõ nguyên nhân, không phải crash không bắt được', async () => {
    const zipPath = makeZipFile('fixture-course');
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    vi.stubGlobal('fetch', fetchMock);
    process.env[TOKEN_ENV] = 'secret-token';

    const { io, err } = makeIo();
    const code = await publish([zipPath, '--server', SERVER], io, SELF);

    expect(code).toBe(1);
    expect(err.join('\n')).toContain('ECONNREFUSED');
  });
});

describe('tuhoc publish — tham số dòng lệnh', () => {
  it('thiếu --server: thoát 1, không gọi fetch', async () => {
    const zipPath = makeZipFile('fixture-course');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.env[TOKEN_ENV] = 'secret-token';

    const { io, err } = makeIo();
    const code = await publish([zipPath], io, SELF);

    expect(code).toBe(1);
    expect(err.join('\n')).toContain('--server');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('thiếu tệp .zip: thoát 1, không gọi fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.env[TOKEN_ENV] = 'secret-token';

    const { io, err } = makeIo();
    const code = await publish(['--server', SERVER], io, SELF);

    expect(code).toBe(1);
    expect(err.join('\n')).toContain('publish');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tệp không tồn tại: thoát 1, nói rõ đường dẫn, không gọi fetch', async () => {
    const dir = mkdtempSync(join(osTmpdir(), 'tuhoc-publish-'));
    cleanupDirs.push(dir);
    const missing = join(dir, 'khong-co.zip');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.env[TOKEN_ENV] = 'secret-token';

    const { io, err } = makeIo();
    const code = await publish([missing, '--server', SERVER], io, SELF);

    expect(code).toBe(1);
    expect(err.join('\n')).toContain(missing);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
