import { describe, expect, it } from 'vitest';
import { REGISTERED_LAB_KINDS } from '../../labs/registry';
import type { RichTextBlock } from '../../types';
import { validateStory } from '../../validateStory';
import story from './story';

const wordCount = (blocks: RichTextBlock[]) => blocks
  .flatMap((block) => block.kind === 'list' ? block.items : [block.text])
  .join(' ').trim().split(/\s+/u).filter(Boolean).length;

describe('A History of Artificial Intelligence', () => {
  it('publishes four acts, twelve ordered scenes, and the twelve AI issue labs', () => {
    const expected = new Set([
      'external-memory', 'embodied-calculation', 'executable-rules',
      'computation-limits', 'judgment-criteria', 'linear-separator',
      'knowledge-bottleneck', 'gradient-descent', 'convolution',
      'attention', 'agent-trace', 'agi-definitions',
    ]);

    expect(story.acts).toHaveLength(4);
    expect(story.scenes.map((scene) => scene.id)).toEqual(Array.from({ length: 12 }, (_, index) => `scene-${String(index + 1).padStart(2, '0')}`));
    expect(new Set(story.scenes.map((scene) => scene.lab.kind))).toEqual(expected);
    for (const scene of story.scenes) expect(REGISTERED_LAB_KINDS.has(scene.lab.kind)).toBe(true);
    expect(story.meta.sceneCount).toBe(12);
    expect(story.meta.labCount).toBe(12);
    expect(validateStory(story, REGISTERED_LAB_KINDS)).toEqual([]);
  });

  it.each(['vi', 'en'] as const)('gives %s readers substantial cited scene copy', (lang) => {
    for (const scene of story.scenes) {
      expect(wordCount(scene.humanStory[lang])).toBeGreaterThanOrEqual(120);
      expect(wordCount(scene.humanStory[lang])).toBeLessThanOrEqual(210);
      expect(wordCount(scene.technicalHinge[lang])).toBeGreaterThanOrEqual(70);
      expect(scene.sourceIds.length).toBeGreaterThanOrEqual(2);
      expect(scene.sourceIds.length).toBeLessThanOrEqual(4);
      expect(scene.illustration.caption[lang]).toMatch(lang === 'vi' ? /^Minh hoạ/u : /^Illustration/u);
    }
  });

  it('does not turn a contested horizon into a personalization or AGI promise', () => {
    const copy = JSON.stringify(story).toLowerCase();
    for (const phrase of ['cá nhân hoá cho bạn', 'personalized for you', 'agi has been achieved', 'đã đạt agi', 'agi score', 'điểm agi']) {
      expect(copy).not.toContain(phrase);
    }
  });

  it('maps wartime labor and the contested AGI frames to sources that support those claims', () => {
    const wartime = story.scenes.find((scene) => scene.id === 'scene-04');
    const horizon = story.scenes.find((scene) => scene.id === 'scene-12');

    expect(wartime?.sourceIds).toEqual([
      'turing-1950', 'ieee-shannon', 'uk-national-archives-colossus', 'chm-colossus',
    ]);
    expect(horizon?.sourceIds).toEqual(['stanford-agi', 'deepmind-levels-agi', 'ai-index-2026']);

    if (!horizon || horizon.lab.kind !== 'agi-definitions') throw new Error('Expected scene-12 AGI definitions lab.');
    const definitions = horizon.lab.config.definitions;
    expect(definitions?.map((definition) => definition.sourceId)).toEqual([
      'stanford-agi', 'deepmind-levels-agi', 'deepmind-levels-agi', 'ai-index-2026',
    ]);
    expect(definitions?.every((definition) => definition.note.en.includes('does not assign these placements'))).toBe(true);
  });

  it('does not pad English copy with a repeated generic disclaimer', () => {
    expect(JSON.stringify(story)).not.toContain('This remains a partial account.');
  });
});
