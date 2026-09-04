import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const forbidden = [
  /src\/stories\/content\/a-history-of-ai\/(?:act-[1-4]|story|sources|assets)\.ts$/,
  /src\/stories\/labs\/(?:external-memory|embodied-calculation|executable-rules|computation-limits|judgment-criteria|linear-separator|knowledge-bottleneck|gradient-descent|convolution|attention|agent-trace|agi-definitions)\//,
];

/** Return forbidden source modules recorded in the entry's static chunk graph. */
export function findStoryStaticLeaks(evidence) {
  const leaks = new Set();
  for (const chunk of evidence.staticChunks ?? []) {
    for (const moduleId of chunk.modules ?? []) {
      if (forbidden.some((pattern) => pattern.test(moduleId))) leaks.add(moduleId);
    }
  }
  return [...leaks].sort();
}

async function main() {
  const evidenceUrl = new URL('../dist/.vite/story-static-graph.json', import.meta.url);
  const evidence = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  const leaks = findStoryStaticLeaks(evidence);
  if (leaks.length > 0) {
    console.error(`Landing entry statically contains full story/lab modules:\n${leaks.join('\n')}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
