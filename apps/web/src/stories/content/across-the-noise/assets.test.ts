// @vitest-environment node
import { expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { IllustrationProvenance } from '../../types';

type MeasuredPlate = IllustrationProvenance & {
  sha256: string; smallSha256: string; smallFilename: string; smallBytes: number;
  quality: number; smallQuality: number; sourceSha256: string;
};
const directory = fileURLToPath(new URL('./', import.meta.url));
const ids = ['cover', ...Array.from({ length: 12 }, (_, i) => `scene-${String(i + 1).padStart(2, '0')}`)];

it('supplies thirteen original plates and twenty-six verified responsive files within byte budgets', () => {
  expect(existsSync(`${directory}provenance.json`), 'complete measured provenance exists').toBe(true);
  const provenance: MeasuredPlate[] = JSON.parse(readFileSync(`${directory}provenance.json`, 'utf8'));
  expect(provenance).toHaveLength(13);
  expect(provenance.map(record => record.sceneId).sort()).toEqual(ids);
  expect(new Set(provenance.map(record => record.sha256)).size).toBe(13);
  expect(new Set(provenance.map(record => record.sourceSha256)).size).toBe(13);
  const filenames: string[] = [];
  for (const record of provenance) {
    expect(record.license).toBe('project-generated');
    expect(record.width).toBe(1536);
    expect(record.height).toBe(1024);
    for (const field of ['sourceOutput', 'createdAt', 'tool', 'model', 'prompt']) expect(record[field as keyof IllustrationProvenance]).toBeTruthy();
    expect(Number.isFinite(Date.parse(record.createdAt))).toBe(true);
    expect(record.edits).toBeInstanceOf(Array);
    for (const [filename, bytes, hash, width, height, budget, quality] of [
      [record.filename, record.bytes, record.sha256, 1536, 1024, record.sceneId === 'cover' ? 250000 : 320000, record.quality],
      [record.smallFilename, record.smallBytes, record.smallSha256, 768, 512, 100000, record.smallQuality],
    ] as const) {
      filenames.push(filename);
      const path = fileURLToPath(new URL(`./assets/${filename}`, import.meta.url));
      const data = readFileSync(path);
      expect(statSync(path).size).toBe(bytes);
      expect(bytes).toBeLessThanOrEqual(budget);
      expect(createHash('sha256').update(data).digest('hex')).toBe(hash);
      expect(data.toString('ascii', 0, 4)).toBe('RIFF');
      expect(data.toString('ascii', 8, 16)).toBe('WEBPVP8 ');
      expect(data.readUInt16LE(26) & 0x3fff).toBe(width);
      expect(data.readUInt16LE(28) & 0x3fff).toBe(height);
      expect([85, 80, 75, 70]).toContain(quality);
    }
  }
  expect(readdirSync(`${directory}assets`).sort()).toEqual(filenames.sort());
});

it('exposes correctly mapped images with bilingual text and measured metadata to the reader', async () => {
  expect(existsSync(`${directory}assets.ts`), 'scene image module exists').toBe(true);
  expect(existsSync(`${directory}cover.ts`), 'isolated cover module exists').toBe(true);
  const { noiseIllustrations } = await import('./assets');
  const { noiseCover } = await import('./cover');
  const { issueCopy } = await import('./copy');
  const provenance: MeasuredPlate[] = JSON.parse(readFileSync(`${directory}provenance.json`, 'utf8'));
  expect(Object.keys(noiseIllustrations).sort()).toEqual(ids.slice(1));
  for (const record of provenance) {
    const image = record.sceneId === 'cover' ? noiseCover : noiseIllustrations[record.sceneId];
    expect(image.src).toContain(record.filename);
    expect(image.srcSet).toContain(`${record.smallFilename} 768w`);
    expect(image.srcSet).toContain(`${record.filename} 1536w`);
    expect(image.bytes).toBe(record.bytes);
    expect(image.provenanceId).toBe(record.id);
    expect(image.width).toBe(1536);
    expect(image.height).toBe(1024);
    expect(image.alt).toEqual(issueCopy.imageText[record.sceneId].alt);
    expect(image.caption).toEqual(issueCopy.imageText[record.sceneId].caption);
    if (record.sceneId !== 'cover') {
      expect(image.sizes).toBe('(max-width: 900px) 100vw, 58vw');
      expect(noiseIllustrations[record.sceneId].dominantColor).toMatch(/^#[0-9a-f]{6}$/i);
    }
  }
});
