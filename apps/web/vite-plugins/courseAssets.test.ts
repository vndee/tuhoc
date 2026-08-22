import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  classifyCourseDirs,
  findUnpublishableInDist,
  readPublicCourseIds,
} from './courseAssets.ts';

/**
 * The publish gate of S1-C2b, tested from both sides.
 *
 * What this is guarding: `closeBundle()` copies course packages into
 * `apps/web/dist/`, and `dist/` is the directory `wrangler pages deploy dist`
 * uploads to a public, unauthenticated host. Before this gate the copy took
 * the whole `courses/` working directory — which on the author's machine
 * holds their private textbook, unpacked there by `make courses`. The review
 * that produced this file measured 46 files / 1.20 MB of it already sitting
 * in `dist/`, guarded by nothing but a paragraph of prose in docs/deploy.md.
 *
 * A gate that only ever runs green proves nothing, so every case below is
 * paired: the same function is shown saying yes to a package this repo
 * publishes and no to one it does not. The "no" half is the half that
 * matters, and it is written so that deleting the filter in
 * `copyPublicCoursesOnly` makes it fail.
 */

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'course-assets-gate-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeCourse(root: string, dir: string, manifest: unknown | null) {
  const target = path.join(root, dir);
  fs.mkdirSync(path.join(target, 'chapters'), { recursive: true });
  fs.writeFileSync(path.join(target, 'chapters', 'p1-1.html'), '<p>x</p>');
  if (manifest !== null) {
    fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest));
  }
  return target;
}

describe('readPublicCourseIds', () => {
  it('reads ids from fixtures/courses/*/manifest.json, not from directory names', () => {
    const fixtures = path.join(tmp, 'fixtures');
    // Directory name and manifest id deliberately differ: the id is what the
    // rest of the gate compares against, so it has to come from the manifest.
    writeCourse(fixtures, 'some-folder-name', { id: 'sample-course', title: 'Mẫu' });
    expect([...readPublicCourseIds(fixtures)]).toEqual(['sample-course']);
  });

  it('fails CLOSED: a missing fixtures directory allows nothing rather than everything', () => {
    // The consequence of this empty set is an empty `dist/courses/`, which is
    // a documented, correct state for this platform (docs/deploy.md). The
    // consequence of failing open would be the author's textbook on a CDN.
    expect(readPublicCourseIds(path.join(tmp, 'does-not-exist')).size).toBe(0);
  });

  it('fails CLOSED on an unparseable manifest', () => {
    const fixtures = path.join(tmp, 'fixtures');
    fs.mkdirSync(path.join(fixtures, 'broken'), { recursive: true });
    fs.writeFileSync(path.join(fixtures, 'broken', 'manifest.json'), '{ not json');
    expect(readPublicCourseIds(fixtures).size).toBe(0);
  });
});

describe('classifyCourseDirs', () => {
  it('says yes to a package this repo publishes and NO to one it does not', () => {
    const courses = path.join(tmp, 'courses');
    writeCourse(courses, 'sample-course', { id: 'sample-course', title: 'Mẫu' });
    writeCourse(courses, 'private-textbook', { id: 'private-textbook', title: 'Riêng tư' });

    const verdicts = classifyCourseDirs(courses, new Set(['sample-course']));
    const byDir = Object.fromEntries(verdicts.map((v) => [v.dir, v]));

    expect(byDir['sample-course'].isPublic).toBe(true);
    expect(byDir['private-textbook'].isPublic).toBe(false);
    expect(byDir['private-textbook'].reason).toContain('fixtures/courses/');
  });

  it('ignores .gitkeep — an empty working directory has nothing to classify', () => {
    const courses = path.join(tmp, 'courses');
    fs.mkdirSync(courses, { recursive: true });
    fs.writeFileSync(path.join(courses, '.gitkeep'), '');
    expect(classifyCourseDirs(courses, new Set(['sample-course']))).toEqual([]);
  });

  it('a missing courses/ is a normal state, not a throw', () => {
    expect(classifyCourseDirs(path.join(tmp, 'nope'), new Set(['sample-course']))).toEqual([]);
  });

  it('refuses a directory whose NAME is public but whose manifest.id is not', () => {
    // The shadowing attack this closes: park a private package under a public
    // package's directory name and the name check alone would wave it through.
    // `scripts/course_workspace.py` unpacks to `courses/<manifest id>/`, so
    // the two agreeing is the normal case; disagreement means something
    // hand-made is sitting there.
    const courses = path.join(tmp, 'courses');
    writeCourse(courses, 'sample-course', { id: 'private-textbook', title: 'Riêng tư' });
    const [verdict] = classifyCourseDirs(courses, new Set(['sample-course']));
    expect(verdict.isPublic).toBe(false);
    expect(verdict.reason).toContain('not the directory name');
  });

  it('refuses a public directory name with no readable manifest', () => {
    const courses = path.join(tmp, 'courses');
    writeCourse(courses, 'sample-course', null);
    const [verdict] = classifyCourseDirs(courses, new Set(['sample-course']));
    expect(verdict.isPublic).toBe(false);
    expect(verdict.reason).toContain('manifest.json');
  });
});

describe('findUnpublishableInDist — the check that makes `bun run build` red', () => {
  it('is silent on a bundle that carries only public packages', () => {
    const dist = path.join(tmp, 'dist-courses');
    writeCourse(dist, 'sample-course', { id: 'sample-course', title: 'Mẫu' });
    expect(findUnpublishableInDist(dist, new Set(['sample-course']))).toEqual([]);
  });

  it('NAMES a private package that reached dist/ — this is the red state', () => {
    const dist = path.join(tmp, 'dist-courses');
    writeCourse(dist, 'sample-course', { id: 'sample-course', title: 'Mẫu' });
    writeCourse(dist, 'private-textbook', { id: 'private-textbook', title: 'Riêng tư' });
    expect(findUnpublishableInDist(dist, new Set(['sample-course']))).toEqual([
      'private-textbook',
    ]);
  });

  it('catches a stray FILE too, not just a directory', () => {
    // Something arriving by a path this plugin knows nothing about — a hand
    // copy, a `cp -r`, a half-finished build from another branch.
    const dist = path.join(tmp, 'dist-courses');
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'private-notes.html'), '<p>riêng tư</p>');
    expect(findUnpublishableInDist(dist, new Set(['sample-course']))).toEqual([
      'private-notes.html',
    ]);
  });

  it('with no public ids at all, EVERYTHING in dist/courses is unpublishable', () => {
    // Pairs with `readPublicCourseIds` failing closed: if the allowlist could
    // not be read, the correct bundle carries no courses, so anything there is
    // wrong.
    const dist = path.join(tmp, 'dist-courses');
    writeCourse(dist, 'sample-course', { id: 'sample-course', title: 'Mẫu' });
    expect(findUnpublishableInDist(dist, new Set())).toEqual(['sample-course']);
  });

  it('a missing dist/courses is clean, not an error', () => {
    expect(findUnpublishableInDist(path.join(tmp, 'nope'), new Set(['sample-course']))).toEqual(
      [],
    );
  });
});
