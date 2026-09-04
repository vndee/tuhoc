import { describe, expect, it } from 'vitest';
import { findStoryStaticLeaks } from './check-story-bundles.mjs';

const manifestWithMetaAndCover = {
  'index.html': { file: 'assets/index.js', isEntry: true, imports: ['src/stories/content/a-history-of-ai/meta.ts'] },
  'src/stories/content/a-history-of-ai/meta.ts': { file: 'assets/meta.js', imports: ['src/stories/content/a-history-of-ai/cover.ts'] },
  'src/stories/content/a-history-of-ai/cover.ts': { file: 'assets/cover.js' },
};

const manifestWithLeaks = {
  'index.html': { file: 'assets/index.js', isEntry: true, imports: [
    'src/stories/content/a-history-of-ai/act-1.ts',
    'src/stories/content/a-history-of-ai/assets.ts',
    'src/stories/labs/attention/AttentionLab.tsx',
  ] },
  'src/stories/content/a-history-of-ai/act-1.ts': { file: 'assets/act.js' },
  'src/stories/content/a-history-of-ai/assets.ts': { file: 'assets/story-assets.js' },
  'src/stories/labs/attention/AttentionLab.tsx': { file: 'assets/attention.js' },
};

const manifestWithDynamicIssueAndLabs = {
  'index.html': { file: 'assets/index.js', isEntry: true, dynamicImports: ['src/stories/content/a-history-of-ai/story.ts'] },
  'src/stories/content/a-history-of-ai/story.ts': { file: 'assets/story.js', dynamicImports: ['src/stories/labs/attention/AttentionLab.tsx'] },
  'src/stories/labs/attention/AttentionLab.tsx': { file: 'assets/attention.js' },
};

describe('findStoryStaticLeaks', () => {
  it('allows metadata and cover in the entry static graph', () => {
    expect(findStoryStaticLeaks(manifestWithMetaAndCover)).toEqual([]);
  });

  it('rejects act copy, full asset maps, and lab components in the entry static graph', () => {
    expect(findStoryStaticLeaks(manifestWithLeaks)).toEqual([
      'src/stories/content/a-history-of-ai/act-1.ts',
      'src/stories/content/a-history-of-ai/assets.ts',
      'src/stories/labs/attention/AttentionLab.tsx',
    ]);
  });

  it('does not traverse dynamicImports', () => {
    expect(findStoryStaticLeaks(manifestWithDynamicIssueAndLabs)).toEqual([]);
  });
});
