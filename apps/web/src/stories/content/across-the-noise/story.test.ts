import { describe, expect, it } from 'vitest';
import { REGISTERED_LAB_KINDS } from '../../labs/registry';
import type { RichTextBlock } from '../../types';
import { validateStory } from '../../validateStory';
import { issueCopy } from './copy';
import { noiseMeta } from './meta';
import story from './story';

const wordCount = (blocks: RichTextBlock[]) => blocks
  .flatMap((block) => block.kind === 'list' ? block.items : [block.text])
  .join(' ').trim().split(/\s+/u).filter(Boolean).length;

const expectedCounts = [
  [149, 128, 87, 78], [145, 134, 89, 84], [144, 133, 87, 87],
  [156, 132, 93, 85], [152, 133, 98, 89], [156, 131, 94, 88],
  [155, 134, 99, 86], [153, 135, 95, 83], [151, 138, 94, 86],
  [161, 137, 101, 90], [158, 134, 100, 86], [159, 138, 96, 83],
] as const;

const expectedSources = [
  ['morse-archive', 'unicode-segmentation'],
  ['morse-tape', 'morse-archive', 'huffman-1952'],
  ['itu-morse', 'morse-tape'],
  ['cable-history', 'cable-object', 'cable-workers'],
  ['mit-isi', 'cable-object'],
  ['shannon-1948', 'ibm-repetition'],
  ['shannon-1948', 'mit-capacity'],
  ['huffman-1952', 'unicode-normalization'],
  ['mit-code', 'ibm-repetition'],
  ['hamming-1950', 'mit-code'],
  ['mit-capacity', 'mit-code', 'shannon-1948'],
  ['shannon-1948', 'morse-archive'],
] as const;

describe('Across the Noise assembled edition', () => {
  it('assembles a valid unpublished four-act story with all twelve communication labs', () => {
    expect(noiseMeta).toMatchObject({
      slug: 'across-the-noise', issueNumber: 2, published: false, featured: false,
      sceneCount: 12, labCount: 12,
    });
    expect(story.meta).toBe(noiseMeta);
    expect(story.acts).toHaveLength(4);
    expect(story.scenes.map((scene) => scene.id)).toEqual(
      Array.from({ length: 12 }, (_, index) => `scene-${String(index + 1).padStart(2, '0')}`),
    );
    expect(story.scenes.map((scene) => scene.lab.kind)).toEqual([
      'message-budget', 'ambiguous-code', 'morse-spacing', 'cable-route',
      'pulse-channel', 'binary-noise', 'source-entropy', 'huffman-message',
      'repetition-channel', 'secded-inspector', 'channel-budget', 'message-meaning',
    ]);
    expect(new Set(story.scenes.map((scene) => scene.lab.kind))).toHaveLength(12);
    for (const scene of story.scenes) expect(REGISTERED_LAB_KINDS.has(scene.lab.kind)).toBe(true);
    expect(validateStory(story)).toEqual([]);
  });

  it('keeps collection metadata synchronized with the approved title and deck only', () => {
    expect(noiseMeta.title).toEqual(issueCopy.title);
    expect(noiseMeta.deck).toEqual(issueCopy.deck);
  });

  it('preserves the approved provenance edit history without synthetic edits', () => {
    expect(story.provenance).toHaveLength(13);
    expect(story.provenance.filter((record) => record.edits.length === 0)).toHaveLength(9);
    expect(story.provenance.filter((record) => record.edits.length > 0).map((record) => record.sceneId))
      .toEqual(['scene-04', 'scene-10', 'scene-11', 'scene-12']);
  });

  it('preserves the full audited word counts and source relationships in both locales', () => {
    story.scenes.forEach((scene, index) => {
      expect([
        wordCount(scene.humanStory.vi),
        wordCount(scene.humanStory.en),
        wordCount(scene.technicalHinge.vi),
        wordCount(scene.technicalHinge.en),
      ]).toEqual(expectedCounts[index]);
      expect(scene.sourceIds).toEqual(expectedSources[index]);
      expect(scene.sourceIds.length).toBeGreaterThanOrEqual(2);
      expect(scene.sourceIds.length).toBeLessThanOrEqual(4);
    });
  });

  it('connects the route-only message journey, intro and coda action without changing the approved values', () => {
    expect(story.interaction).toEqual({
      kind: 'message-journey',
      examples: {
        vi: 'Mình đã đến nơi. Mọi chuyện vẫn ổn.',
        en: 'I have arrived. Everything is all right.',
      },
    });
    expect(story.intro).toBe(issueCopy.intro);
    expect(story.coda).toBe(issueCopy.coda);
    expect(story.courseAction).toBe(issueCopy.courseAction);
  });
});
