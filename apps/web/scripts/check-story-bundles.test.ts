import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { findStoryStaticLeaks } from './check-story-bundles.mjs';
import { storyStaticGraphEvidencePlugin } from './story-static-graph.ts';
import { labEntryPaths } from './lab-entry-paths.ts';
import { ALL_LAB_KINDS } from '../src/stories/types';

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
  it('pairs actual compiled retry metadata with its referencing build without eagerly importing the lab', async () => {
    expect(Object.keys(labEntryPaths).sort()).toEqual([...ALL_LAB_KINDS].sort());
    const root = await mkdtemp(path.join(tmpdir(), 'story-retry-build-'));
    const directory = path.join(root, 'src/stories/labs/message-budget');
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(root, 'index.html'), '<script type="module" src="/main.js"></script>');
      await writeFile(path.join(root, 'main.js'), "import {buildId,mapPath} from 'virtual:story-lab-retry'; globalThis.retryMetadata={buildId,mapPath}; globalThis.openLab=()=>import('./src/stories/labs/message-budget/MessageBudgetLab.tsx');");
      await writeFile(path.join(directory, 'MessageBudgetLab.tsx'), 'export default function Lab() { return 42; }');
      const output = await build({ root, logLevel: 'silent', plugins: [storyStaticGraphEvidencePlugin()], build: { write: false } });
      if (Array.isArray(output) || !('output' in output)) throw new Error('unexpected-build-output');
      const metadata = output.output.find(item => item.type === 'asset' && /story-labs-.*\.json$/.test(item.fileName));
      if (!metadata || metadata.type !== 'asset') throw new Error('retry-metadata-missing');
      const map = JSON.parse(String(metadata.source));
      const entry = output.output.find(item => item.type === 'chunk' && item.isEntry);
      if (!entry || entry.type !== 'chunk') throw new Error('entry-missing');
      expect(entry.code).toContain(map.buildId);
      expect(entry.code).toContain(metadata.fileName);
      const mapped = output.output.find(item => item.fileName === `assets/${map.entries['message-budget'].slice(2)}`);
      expect(mapped?.type).toBe('chunk');
      expect(entry.imports).not.toContain(mapped?.fileName);
      expect(map.entries).toEqual({ 'message-budget': expect.stringMatching(/^\.\/MessageBudgetLab-[\w-]+\.js$/) });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('rejects all issue content, session runtime, and every lab engine except explicit entry-safe definitions', () => {
    const modules = [
      'src/stories/content/across-the-noise/copy.ts',
      'src/stories/content/across-the-noise/sources.ts',
      'src/stories/content/across-the-noise/assets/scene-01.webp',
      'src/stories/content/across-the-noise/provenance.json',
      'src/stories/content/future-issue/narrative.ts',
      'src/stories/labs/communication/noise.ts',
      'src/stories/labs/huffman-message/codec.ts',
      'src/stories/session/StoryIssueSessionProvider.tsx',
    ];
    expect(findStoryStaticLeaks({ staticChunks: [{ modules }] })).toEqual([...modules].sort());
    expect(findStoryStaticLeaks({ staticChunks: [{ modules: [
      'src/stories/content/across-the-noise/meta.ts',
      'src/stories/content/across-the-noise/cover.ts',
      'src/stories/content/across-the-noise/assets/cover-768.webp',
      'src/stories/labs/registry.ts',
      'src/stories/labs/communication/types.ts',
      'src/stories/session/types.ts',
    ] }] })).toEqual([]);
  });
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
