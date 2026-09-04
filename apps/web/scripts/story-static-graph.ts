import type { Plugin } from 'vite';

interface OutputChunkLike {
  type: 'chunk';
  fileName: string;
  isEntry: boolean;
  imports: string[];
  modules: Record<string, unknown>;
}

type OutputBundleLike = Record<string, OutputChunkLike | { type: string }>;

/**
 * Produces build evidence from Rollup's final chunks. The Vite manifest names
 * output chunks but does not retain source modules folded into an entry.
 */
export function collectStaticEntryGraph(bundle: OutputBundleLike) {
  const chunks = Object.values(bundle).filter((item): item is OutputChunkLike => item.type === 'chunk');
  const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const staticFileNames = new Set<string>();

  const visit = (fileName: string) => {
    if (staticFileNames.has(fileName)) return;
    const chunk = byFileName.get(fileName);
    if (!chunk) return;
    staticFileNames.add(fileName);
    for (const imported of chunk.imports) visit(imported);
  };

  const entryChunks = chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName).sort();
  for (const entryChunk of entryChunks) visit(entryChunk);

  return {
    version: 1,
    entryChunks,
    staticChunks: [...staticFileNames].sort().map((fileName) => ({
      fileName,
      modules: Object.keys(byFileName.get(fileName)!.modules).sort(),
    })),
  };
}

export function storyStaticGraphEvidencePlugin(): Plugin {
  return {
    name: 'story-static-graph-evidence',
    generateBundle(_options, bundle) {
      this.emitFile({
        type: 'asset',
        fileName: '.vite/story-static-graph.json',
        source: `${JSON.stringify(collectStaticEntryGraph(bundle), null, 2)}\n`,
      });
    },
  };
}
