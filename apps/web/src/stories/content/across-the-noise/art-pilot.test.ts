// @vitest-environment node
import { expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

it('provides three distinct original plates and six dimensioned exports with actual provenance', () => {
  const manifestPath = path.join(directory, 'art-pilot.json');
  expect(existsSync(manifestPath), 'actual generation manifest exists').toBe(true);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  expect(manifest.map((entry: { sceneId: string }) => entry.sceneId).sort()).toEqual(['cover', 'scene-01', 'scene-12']);
  const hashes: string[] = [];
  const originals: string[] = [];
  for (const entry of manifest) {
    for (const key of ['sourceOutput', 'createdAt', 'tool', 'model', 'prompt', 'license']) {
      expect(typeof entry[key]).toBe('string');
      expect(entry[key].trim().length).toBeGreaterThan(0);
    }
    expect(Number.isFinite(Date.parse(entry.createdAt))).toBe(true);
    expect(Array.isArray(entry.edits)).toBe(true);
    expect(entry.edits.every((edit: unknown) => typeof edit === 'string' && edit.trim().length > 0)).toBe(true);
    // Actual tool paths are provenance, not a dependency on this author's machine.
    expect(path.isAbsolute(entry.sourceOutput)).toBe(true);
    expect(entry.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    originals.push(entry.sourceSha256);
    for (const [suffix, width, height, budget] of [['', 1536, 1024, entry.sceneId === 'cover' ? 250000 : 320000], ['-768', 768, 512, 100000]] as const) {
      const output = path.join(directory, 'assets', `${entry.sceneId}${suffix}.webp`);
      expect(existsSync(output), `${entry.sceneId}${suffix} exists`).toBe(true);
      const bytes = readFileSync(output);
      expect(bytes.length).toBeLessThanOrEqual(budget);
      expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
      expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
      // cwebp's lossy VP8 frame header carries dimensions independently of our exporter.
      expect(bytes.toString('ascii', 12, 16)).toBe('VP8 ');
      expect(bytes.readUInt16LE(26) & 0x3fff).toBe(width);
      expect(bytes.readUInt16LE(28) & 0x3fff).toBe(height);
      hashes.push(digest(output));
    }
  }
  expect(new Set(originals).size).toBe(3);
  expect(new Set(hashes).size).toBe(6);
});
