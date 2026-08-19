/**
 * Course package shapes, as produced by `tools/extract.py` into
 * `courses/<id>/manifest.json` (see spec §3). Kept intentionally identical
 * to the task-10 brief's contract — Task 11 (the reader) imports these
 * types and `loadManifest`/`loadChapter` from `./loader` directly.
 */

export interface Chapter {
  id: string;
  num: string;
  title: string;
  short: string;
  /** Path to the chapter's HTML fragment, relative to the course dir — e.g. "chapters/p0-1.html". */
  file: string;
}

export interface Part {
  title: string;
  chapters: Chapter[];
}

export interface Manifest {
  id: string;
  title: string;
  description: string;
  lang: string;
  version: string;
  /** Caret range this manifest requires from the web app's course runtime, e.g. "^1". */
  runtime: string;
  parts: Part[];
}
