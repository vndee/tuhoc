import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { findStoryStaticLeaks } from './check-story-bundles.mjs';
import { storyStaticGraphEvidencePlugin } from './story-static-graph.ts';

const staticEvidenceWithMetaAndCover = {
  entryChunks: ['assets/index.js'],
  staticChunks: [
    { fileName: 'assets/index.js', modules: ['src/main.ts', 'src/stories/content/a-history-of-ai/meta.ts'] },
    { fileName: 'assets/meta.js', modules: ['src/stories/content/a-history-of-ai/cover.ts'] },
  ],
};

const staticEvidenceWithFoldedLeaks = {
  entryChunks: ['assets/index.js'],
  staticChunks: [{ fileName: 'assets/index.js', modules: [
    'src/main.ts',
    'src/stories/content/a-history-of-ai/act-1.ts',
    'src/stories/content/a-history-of-ai/assets.ts',
    'src/stories/labs/attention/AttentionLab.tsx',
  ] }],
};

const staticEvidenceExcludingDynamicChunks = {
  entryChunks: ['assets/index.js'],
  staticChunks: [{ fileName: 'assets/index.js', modules: ['src/main.ts'] }],
  dynamicChunks: [{ fileName: 'assets/story.js', modules: [
    'src/stories/content/a-history-of-ai/story.ts',
    'src/stories/labs/attention/AttentionLab.tsx',
  ] }],
};

describe('findStoryStaticLeaks', () => {
  it('allows metadata and cover in the entry static graph evidence', () => {
    expect(findStoryStaticLeaks(staticEvidenceWithMetaAndCover)).toEqual([]);
  });

  it('rejects forbidden source modules folded directly into an entry chunk', () => {
    expect(findStoryStaticLeaks(staticEvidenceWithFoldedLeaks)).toEqual([
      'src/stories/content/a-history-of-ai/act-1.ts',
      'src/stories/content/a-history-of-ai/assets.ts',
      'src/stories/labs/attention/AttentionLab.tsx',
    ]);
  });

  it('does not treat dynamic chunks as part of the static entry graph', () => {
    expect(findStoryStaticLeaks(staticEvidenceExcludingDynamicChunks)).toEqual([]);
  });

  it('records a module folded into a real Vite entry while excluding a dynamic story module', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'story-static-graph-'));
    const storyDirectory = path.join(root, 'src/stories/content/a-history-of-ai');
    try {
      await mkdir(storyDirectory, { recursive: true });
      await writeFile(path.join(root, 'index.html'), '<script type="module" src="/main.js"></script>');
      await writeFile(path.join(root, 'main.js'), "import './src/stories/content/a-history-of-ai/act-1.ts'; import('./src/stories/content/a-history-of-ai/story.ts');");
      await writeFile(path.join(storyDirectory, 'act-1.ts'), 'globalThis.__staticStoryFixture = true;');
      await writeFile(path.join(storyDirectory, 'story.ts'), 'globalThis.__dynamicStoryFixture = true;');

      await build({ root, logLevel: 'silent', plugins: [storyStaticGraphEvidencePlugin()], build: { outDir: path.join(root, 'dist'), emptyOutDir: true } });

      const evidence = JSON.parse(await readFile(path.join(root, 'dist/.vite/story-static-graph.json'), 'utf8'));
      const leaks = findStoryStaticLeaks(evidence);
      expect(leaks).toEqual([expect.stringMatching(/src\/stories\/content\/a-history-of-ai\/act-1\.ts$/)]);
      expect(JSON.stringify(evidence)).not.toContain('a-history-of-ai/story.ts');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
