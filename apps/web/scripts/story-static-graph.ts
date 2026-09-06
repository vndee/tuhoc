import type { Plugin } from 'vite';
import { randomUUID } from 'node:crypto';
import { labEntryPaths } from './lab-entry-paths.ts';

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
  const virtualId = 'virtual:story-lab-retry';
  const resolvedId = `\0${virtualId}`;
  let buildId = randomUUID() as string;
  let base = '/';
  let mapFile = '';
  return {
    name: 'story-static-graph-evidence',
    configResolved(config) {
      if (config.command === 'serve') buildId = `dev-${buildId}`;
      base = config.base;
      mapFile = `assets/story-labs-${buildId}.json`;
    },
    resolveId(id) { if (id === virtualId) return resolvedId; },
    load(id) {
      if (id === resolvedId) return `export const buildId=${JSON.stringify(buildId)}; export const mapPath=${JSON.stringify(base + mapFile)};`;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== base + mapFile) return next();
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify({ buildId, entries: Object.fromEntries(Object.entries(labEntryPaths).map(([kind, path]) => [kind, `/src/stories/labs/${path}`])) }));
      });
    },
    generateBundle(_options, bundle) {
      const entries: Record<string, string> = {};
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.facadeModuleId) continue;
        for (const [kind, path] of Object.entries(labEntryPaths)) {
          if (chunk.facadeModuleId.endsWith(`/src/stories/labs/${path}`)) entries[kind] = `./${chunk.fileName.slice('assets/'.length)}`;
        }
      }
      this.emitFile({ type: 'asset', fileName: mapFile, source: JSON.stringify({ buildId, entries }) });
      this.emitFile({
        type: 'asset',
        fileName: '.vite/story-static-graph.json',
        source: `${JSON.stringify(collectStaticEntryGraph(bundle), null, 2)}\n`,
      });
    },
  };
}
