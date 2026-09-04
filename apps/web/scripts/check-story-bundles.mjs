import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const forbidden = [
  /src\/stories\/content\/a-history-of-ai\/(?:act-[1-4]|story|sources|assets)\.ts$/,
  /src\/stories\/labs\/(?:external-memory|embodied-calculation|executable-rules|computation-limits|judgment-criteria|linear-separator|knowledge-bottleneck|gradient-descent|convolution|attention|agent-trace|agi-definitions)\//,
];

/** Return forbidden modules reachable from an entry through static imports only. */
export function findStoryStaticLeaks(manifest) {
  const entryKeys = Object.entries(manifest)
    .filter(([, chunk]) => chunk.isEntry)
    .map(([key]) => key);
  const seen = new Set();
  const leaks = new Set();

  const visit = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    if (forbidden.some((pattern) => pattern.test(key))) leaks.add(key);
    for (const imported of manifest[key]?.imports ?? []) visit(imported);
  };

  for (const key of entryKeys) visit(key);
  return [...leaks].sort();
}

async function main() {
  const manifestUrl = new URL('../dist/.vite/manifest.json', import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const leaks = findStoryStaticLeaks(manifest);
  if (leaks.length > 0) {
    console.error(`Landing entry statically contains full story/lab modules:\n${leaks.join('\n')}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
