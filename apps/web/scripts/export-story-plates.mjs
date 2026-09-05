import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { access, lstat, stat, realpath, readFile, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRelative = 'src/stories/content/across-the-noise/assets';
const execute = promisify(execFile);

export async function checkNativeTools(checkAccess = access) {
  for (const file of ['/usr/bin/sips', '/opt/homebrew/bin/cwebp']) {
    try { await checkAccess(file, constants.X_OK); }
    catch { throw new Error(`Required native artwork tool is unavailable or not executable: ${file}. See docs/testing.md; native conversion coverage has not run.`); }
  }
}

async function optionalLstat(file) {
  try { return await lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function dimensions(file, exec) {
  const { stdout } = await exec('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file]);
  const width = Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(stdout.match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Cannot inspect source dimensions: ${file}`);
  }
  return { width, height };
}

async function validateOutputDirectory(outDir, appRoot) {
  const expected = path.join(appRoot, outputRelative);
  if (path.resolve(outDir) !== expected) throw new Error(`Exact output directory required: ${expected}`);
  // Check every existing component before creating anything; an ancestor symlink
  // must not redirect writes outside the owned asset directory.
  let current = appRoot;
  for (const part of outputRelative.split('/')) {
    current = path.join(current, part);
    const info = await optionalLstat(current);
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error(`Unsafe output directory: ${current}`);
  }
  await mkdir(expected, { recursive: true });
  return expected;
}

function validateManifest(manifest) {
  if (!Array.isArray(manifest) || manifest.length === 0) throw new Error('Manifest must be a nonempty array');
  const ids = new Set();
  for (const record of manifest) {
    if (!record || typeof record !== 'object' || typeof record.sceneId !== 'string' || !/^(cover|scene-(0[1-9]|1[0-2]))$/.test(record.sceneId)) {
      throw new Error('Invalid manifest sceneId');
    }
    if (ids.has(record.sceneId)) throw new Error(`Duplicate sceneId: ${record.sceneId}`);
    ids.add(record.sceneId);
    for (const field of ['sourceOutput', 'createdAt', 'tool', 'model', 'prompt', 'license']) {
      if (typeof record[field] !== 'string' || !record[field].trim()) throw new Error(`Invalid metadata: ${field}`);
    }
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(record.createdAt)
      || !Number.isFinite(Date.parse(record.createdAt))
      || !Array.isArray(record.edits)
      || !record.edits.every(edit => typeof edit === 'string' && edit.trim())) throw new Error('Invalid metadata: date or edits');
  }
}

async function validateDestination(destination, sources) {
  const existing = await optionalLstat(destination);
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error(`Unsafe destination: ${destination}`);
  for (const source of sources) {
    if (source.path === destination || (existing && existing.dev === source.info.dev && existing.ino === source.info.ino)) {
      throw new Error(`Destination would overwrite source: ${destination}`);
    }
  }
}

/** Mechanical conversion only. appRoot/exec injection supports isolated filesystem
 * and external-codec failure tests; the CLI always uses this script's app root. */
export async function exportStoryPlates({ manifestPath, outDir, appRoot = defaultRoot, exec = execute }) {
  const root = path.resolve(appRoot);
  const manifestFile = path.resolve(manifestPath);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  validateManifest(manifest);
  const output = await validateOutputDirectory(path.resolve(outDir), root);
  const sources = [];
  // Preflight all records before invoking the encoder, preserving earlier outputs
  // if any source/ID/destination fails validation.
  for (const record of manifest) {
    let source;
    let info;
    try {
      source = await realpath(path.resolve(path.dirname(manifestFile), record.sourceOutput));
      info = await stat(source);
    } catch { throw new Error(`Missing source: ${record.sourceOutput}`); }
    if (!info.isFile()) throw new Error(`Source is not a file: ${source}`);
    const size = await dimensions(source, exec);
    if (size.width * 2 !== size.height * 3) throw new Error(`Source must be exactly 3:2: ${source}`);
    sources.push({ path: source, info, record });
  }
  const jobs = sources.flatMap(source => [1536, 768].map(width => ({
    source, width, height: width * 2 / 3,
    budget: width === 768 ? 100000 : source.record.sceneId === 'cover' ? 250000 : 320000,
    destination: path.join(output, `${source.record.sceneId}${width === 768 ? '-768' : ''}.webp`),
  })));
  for (const job of jobs) await validateDestination(job.destination, sources);
  const staging = await mkdtemp(path.join(output, '.plate-export-'));
  try {
    const results = [];
    for (const job of jobs) {
      const temporary = path.join(staging, path.basename(job.destination));
      let accepted;
      for (const quality of [85, 80, 75, 70]) {
        await exec('/opt/homebrew/bin/cwebp', [
          '-resize', String(job.width), String(job.height), '-q', String(quality),
          '-metadata', 'none', job.source.path, '-o', temporary,
        ]);
        const bytes = await readFile(temporary);
        if (bytes.length <= job.budget) {
          const size = await dimensions(temporary, exec);
          if (size.width !== job.width || size.height !== job.height) throw new Error('Encoder returned wrong output dimensions');
          accepted = {
            sceneId: job.source.record.sceneId, destination: job.destination,
            width: job.width, height: job.height, quality, budget: job.budget,
            bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
          };
          break;
        }
      }
      if (!accepted) throw new Error(`${job.source.record.sceneId} at ${job.width}px exceeds budget at q70; review art/detail before exporting`);
      results.push(accepted);
    }
    // Publish only once every conversion fits. Recheck destinations immediately
    // before replacing the generated derivatives; source originals stay untouched.
    for (const result of results) await validateDestination(result.destination, sources);
    for (const result of results) await rename(path.join(staging, path.basename(result.destination)), result.destination);
    return results;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--check-tools') {
      await checkNativeTools();
      process.stdout.write('Native artwork prerequisites available; conversion tests must still run.\n');
      process.exit(0);
    }
    if (args.length !== 4 || args[0] !== '--manifest' || args[2] !== '--out') {
      throw new Error('Usage: node scripts/export-story-plates.mjs --manifest <manifest.json> --out src/stories/content/across-the-noise/assets');
    }
    await checkNativeTools();
    const results = await exportStoryPlates({ manifestPath: args[1], outDir: args[3] });
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
