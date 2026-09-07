import { describe, expect, it } from 'vitest';
import type { RichTextBlock } from '../../types';
import { issueCopy } from './copy';

const words = (blocks: RichTextBlock[]) => blocks.flatMap(block => 'text' in block ? [block.text] : block.items).join(' ').trim().split(/\s+/).length;

describe('Across the Noise authored copy', () => {
  it('provides four ordered acts and all twelve complete bilingual scenes', () => {
    expect(issueCopy.acts.map(act => act.sceneIds.length)).toEqual([3, 3, 3, 3]);
    expect(issueCopy.acts.flatMap(act => act.sceneIds)).toEqual(Object.keys(issueCopy.scenes));
    expect(Object.keys(issueCopy.scenes)).toHaveLength(12);
    for (const lang of ['vi', 'en'] as const) {
      expect(issueCopy.title[lang].trim()).not.toBe('');
      expect(issueCopy.deck[lang].trim()).not.toBe('');
      expect(issueCopy.intro[lang]).toHaveLength(2);
      expect(issueCopy.coda[lang]).toHaveLength(2);
      for (const act of issueCopy.acts) {
        expect(act.title[lang].trim()).not.toBe('');
        expect(act.question[lang].trim()).not.toBe('');
        expect(words(act.consequence[lang])).toBeGreaterThan(0);
      }
      for (const scene of Object.values(issueCopy.scenes)) {
        expect(words(scene.humanStory[lang])).toBeGreaterThanOrEqual(120);
        expect(words(scene.humanStory[lang])).toBeLessThanOrEqual(210);
        expect(words(scene.technicalHinge[lang])).toBeGreaterThanOrEqual(70);
        for (const field of ['period', 'title', 'openQuestion'] as const) expect(scene[field][lang].trim()).not.toBe('');
      }
      for (const image of Object.values(issueCopy.imageText)) {
        expect(image.alt[lang].trim()).not.toBe('');
        expect(image.caption[lang]).toMatch(lang === 'vi' ? /^Minh hoạ:/ : /^Illustration:/);
      }
    }
    expect(Object.keys(issueCopy.imageText)).toHaveLength(13);
  });
});
