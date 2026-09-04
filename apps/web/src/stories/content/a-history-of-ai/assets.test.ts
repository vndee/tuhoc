// @vitest-environment node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import provenance from './provenance.json';

const assetPath = (filename: string) =>
  fileURLToPath(new URL(`./assets/${filename}`, import.meta.url));

const sha256 = (path: string) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

describe('history of AI illustration assets', () => {
  it('ships 13 provenance records and both responsive files for each concept', () => {
    expect(provenance).toHaveLength(13);
    for (const record of provenance) {
      expect(record).toMatchObject({
        filename: expect.stringMatching(/\.webp$/),
        id: expect.stringMatching(/^history-ai-(?:cover|scene-\d{2})$/),
        sourceOutput: expect.any(String),
        createdAt: expect.stringMatching(/^2026-09-04/),
        tool: expect.any(String),
        model: expect.any(String),
        prompt: expect.any(String),
        edits: expect.any(Array),
        width: 1536,
        height: 1024,
        bytes: expect.any(Number),
        license: 'project-generated',
        sceneId: expect.stringMatching(/^(cover|scene-\d{2})$/),
      });
      expect(existsSync(assetPath(record.filename))).toBe(true);
      expect(existsSync(assetPath(record.filename.replace('.webp', '-768.webp')))).toBe(true);
    }
  });

  it('keeps the cover and desktop scenes within budget', () => {
    for (const record of provenance) {
      expect(statSync(assetPath(record.filename)).size)
        .toBeLessThanOrEqual(record.sceneId === 'cover' ? 250_000 : 320_000);
    }
  });

  it('does not reuse identical image bytes across scenes', () => {
    expect(new Set(provenance.map((record) => sha256(assetPath(record.filename)))).size).toBe(13);
  });
});
