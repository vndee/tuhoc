// @vitest-environment node
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const exec = promisify(execFile);
let appRoot: string;
let content: string;
let outDir: string;
let manifestPath: string;
// Tiny non-art PNG fixtures: verify conversion behavior without depending on pilot assets.
function png(width: number, height: number) {
  function chunk(type: string, data: Buffer) {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, checksum]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc(height * (width * 3 + 1), 180);
  for (let row = 0; row < height; row++) rows[row * (width * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const record = (sceneId = 'cover', sourceOutput = 'source ; $(touch injected).png') => ({
  sceneId, sourceOutput, createdAt: '2026-09-05T00:00:00Z', tool: 'test fixture', model: 'test fixture', prompt: 'Non-art test fixture', edits: [], license: 'Test fixture',
});
async function save(entries: unknown[]) { await writeFile(manifestPath, JSON.stringify(entries)); }
async function exporter() {
  expect(existsSync(path.resolve('scripts/export-story-plates.mjs')), 'exporter implementation exists').toBe(true);
  return import('./export-story-plates.mjs');
}
beforeAll(async () => { await (await exporter()).checkNativeTools(); });
beforeEach(async () => {
  appRoot = await mkdtemp(path.join(tmpdir(), 'story-plates-test-'));
  content = path.join(appRoot, 'src/stories/content/across-the-noise');
  outDir = path.join(content, 'assets');
  manifestPath = path.join(content, 'art-pilot.json');
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(content, record().sourceOutput), png(6, 4));
  await save([record()]);
});
afterEach(async () => { await rm(appRoot, { recursive: true, force: true }); });

it('exports both sizes with hashes and preserves a source with shell metacharacters', async () => {
  const { exportStoryPlates } = await exporter();
  const before = await readFile(path.join(content, record().sourceOutput));
  const outputs = await exportStoryPlates({ manifestPath, outDir, appRoot });
  expect(outputs.map((output: { width: number; height: number }) => [output.width, output.height])).toEqual([[1536, 1024], [768, 512]]);
  for (const output of outputs) {
    const bytes = await readFile(output.destination);
    expect(output.bytes).toBe(bytes.length);
    expect(output.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(output.quality).toBe(85);
    expect(bytes.readUInt16LE(26) & 0x3fff).toBe(output.width);
    expect(bytes.readUInt16LE(28) & 0x3fff).toBe(output.height);
  }
  expect(await readFile(path.join(content, record().sourceOutput))).toEqual(before);
  expect(existsSync(path.join(content, 'injected'))).toBe(false);
});
it('rejects duplicate scene IDs before writing outputs', async () => {
  const { exportStoryPlates } = await exporter(); await save([record(), record()]);
  await expect(exportStoryPlates({ manifestPath, outDir, appRoot })).rejects.toThrow(/duplicate/i);
  expect(existsSync(path.join(outDir, 'cover.webp'))).toBe(false);
});
it.each(['../escape', 'scene-00', 'scene-13', 'scene-1', ['cover']])('rejects invalid scene ID %s', async sceneId => {
  const { exportStoryPlates } = await exporter(); await save([{ ...record(), sceneId }]);
  await expect(exportStoryPlates({ manifestPath, outDir, appRoot })).rejects.toThrow(/sceneId/);
});
it('rejects nonexistent sources and wrong aspect ratio before exporting earlier records', async () => {
  const { exportStoryPlates } = await exporter(); await save([record(), record('scene-01', 'absent.png')]);
  await expect(exportStoryPlates({ manifestPath, outDir, appRoot })).rejects.toThrow(/source/i);
  await writeFile(path.join(content, 'square.png'), png(4, 4));
  await save([record(), record('scene-01', 'square.png')]);
  await expect(exportStoryPlates({ manifestPath, outDir, appRoot })).rejects.toThrow(/3:2/);
  expect(existsSync(path.join(outDir, 'cover.webp'))).toBe(false);
});
it('rejects invalid metadata and empty manifests', async () => {
  const { exportStoryPlates } = await exporter();
  for (const entries of [[], [{ ...record(), prompt: '' }], [{ ...record(), createdAt: 'yesterday' }], [{ ...record(), edits: [2] }]]) {
    await save(entries);
    await expect(exportStoryPlates({ manifestPath, outDir, appRoot })).rejects.toThrow(/manifest|metadata/i);
  }
});
it('rejects destinations outside the exact assets directory including directory symlinks', async () => {
  const { exportStoryPlates } = await exporter();
  await expect(exportStoryPlates({ manifestPath, outDir: `${outDir}-other`, appRoot })).rejects.toThrow(/output directory/i);
  await rm(outDir, { recursive: true });
  await symlink(appRoot, outDir);
  await expect(exportStoryPlates({ manifestPath, outDir, appRoot })).rejects.toThrow(/output directory/i);
});
it('rejects destination symlinks and hardlinks to the source without modifying it', async () => {
  const { exportStoryPlates } = await exporter();
  const source = path.join(content, record().sourceOutput); const before = await readFile(source);
  const destination = path.join(outDir, 'cover.webp');
  await symlink(source, destination);
  await expect(exportStoryPlates({ manifestPath, outDir, appRoot })).rejects.toThrow(/destination/i);
  await rm(destination); await link(source, destination);
  await expect(exportStoryPlates({ manifestPath, outDir, appRoot })).rejects.toThrow(/source|destination/i);
  expect(await readFile(source)).toEqual(before);
});
it('steps quality down to the first fit and stops at 70 without publishing over-budget files', async () => {
  const { exportStoryPlates } = await exporter();
  const attempted: number[] = [];
  // Exercise the real exporter with the external encoder made deliberately oversized.
  const run = (alwaysLarge: boolean) => async (file: string, args: string[]) => {
    const result = await exec(file, args);
    if (file.endsWith('/cwebp')) attempted.push(Number(args[args.indexOf('-q') + 1]));
    if (file.endsWith('/cwebp') && (alwaysLarge || Number(args[args.indexOf('-q') + 1]) > 75)) {
      await writeFile(args[args.indexOf('-o') + 1], Buffer.alloc(400000));
    }
    return result;
  };
  const outputs = await exportStoryPlates({ manifestPath, outDir, appRoot, exec: run(false) });
  expect(outputs.map((output: { quality: number }) => output.quality)).toEqual([75, 75]);
  expect(attempted).toEqual([85, 80, 75, 85, 80, 75]);
  attempted.length = 0;
  const before = await readFile(path.join(outDir, 'cover.webp'));
  await expect(exportStoryPlates({ manifestPath, outDir, appRoot, exec: run(true) })).rejects.toThrow(/q70.*review/i);
  expect(attempted).toEqual([85, 80, 75, 70]);
  expect(await readFile(path.join(outDir, 'cover.webp'))).toEqual(before);
});
