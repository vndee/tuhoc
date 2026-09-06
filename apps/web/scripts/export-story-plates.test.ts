// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

let appRoot: string;
let content: string;
let outDir: string;
let manifestPath: string;
// Tiny non-art PNG fixtures for portable source and safety validation.
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
  const implementation = await import('./export-story-plates.mjs');
  return { exportStoryPlates: (options: Parameters<typeof implementation.exportStoryPlates>[0]) =>
    implementation.exportStoryPlates({ ...options, exec: inspectFixture }) };
}
// This boundary adapter only inspects our tiny PNG fixtures. Any encoder call
// fails, so portable safety validation cannot accidentally require native tools.
async function inspectFixture(file: string, args: string[]) {
  if (file !== '/usr/bin/sips' || args[0] !== '-g') throw new Error('Unexpected conversion in portable validation');
  const bytes = await readFile(args.at(-1)!);
  return { stdout: `pixelWidth: ${bytes.readUInt32BE(16)}\npixelHeight: ${bytes.readUInt32BE(20)}` };
}
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
