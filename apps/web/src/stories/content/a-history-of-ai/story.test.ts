import { describe, expect, it } from 'vitest';
import { REGISTERED_LAB_KINDS } from '../../labs/registry';
import type { RichTextBlock } from '../../types';
import { validateStory } from '../../validateStory';
import story from './story';

const wordCount = (blocks: RichTextBlock[]) => blocks
  .flatMap((block) => block.kind === 'list' ? block.items : [block.text])
  .join(' ').trim().split(/\s+/u).filter(Boolean).length;

describe('A History of Artificial Intelligence', () => {
  it('publishes four acts, twelve ordered scenes, and every registered lab', () => {
    expect(story.acts).toHaveLength(4);
    expect(story.scenes.map((scene) => scene.id)).toEqual(Array.from({ length: 12 }, (_, index) => `scene-${String(index + 1).padStart(2, '0')}`));
    expect(new Set(story.scenes.map((scene) => scene.lab.kind))).toEqual(REGISTERED_LAB_KINDS);
    expect(story.meta.sceneCount).toBe(12);
    expect(story.meta.labCount).toBe(12);
    expect(validateStory(story, REGISTERED_LAB_KINDS)).toEqual([]);
  });

  it.each(['vi', 'en'] as const)('gives %s readers substantial cited scene copy', (lang) => {
    for (const scene of story.scenes) {
      expect(wordCount(scene.humanStory[lang])).toBeGreaterThanOrEqual(120);
      expect(wordCount(scene.humanStory[lang])).toBeLessThanOrEqual(180);
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
});
