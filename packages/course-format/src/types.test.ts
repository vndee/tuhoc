import { describe, expect, it } from 'vitest';
import { parseManifest } from './validate';
import type { GeneratedBy, Manifest } from './types';

/**
 * These tests are half runtime, half **type gate**.
 *
 * The `@ts-expect-error` lines are the interesting half: each one asserts that
 * the compiler still rejects the code beneath it. If someone makes `license`
 * optional, or widens `generatedBy` to `string`, the error disappears and
 * `bun run typecheck` (`tsc -b`) fails with "Unused '@ts-expect-error'
 * directive" — a red gate, not a silently-passing suite. Vitest itself does not
 * type-check, so these lines are inert at runtime by design; the value is in
 * `make test-format`'s sibling gate.
 *
 * Format v2 killed `tier` (task 1 of the server-side pivot,
 * `docs/superpowers/specs/2026-08-25-server-side-pivot.md` §2.3): it is not
 * merely absent from `V2` below, it does not compile as a `Manifest` property
 * at all any more. `validate.test.ts` covers the RUNTIME side of that —
 * `TIER_REMOVED` when a manifest still carries the key — this file covers the
 * type side: nobody can write `manifest.tier` again by accident.
 */

const V2: Manifest = {
  id: 'demo',
  title: 'Demo',
  description: 'd',
  lang: 'vi',
  version: '1.0.0',
  runtime: '^1',
  license: 'CC-BY-4.0',
  authors: [{ name: 'A' }, { name: 'B', url: 'https://example.org' }],
  generatedBy: 'human',
  parts: [{ title: 'P', chapters: [{ id: 'c1', num: '1', title: 'T', short: 'T', file: 'chapters/c1.html' }] }],
};

describe('Manifest v2', () => {
  it('mang đủ ba trường mới cùng hai trường tuỳ chọn', () => {
    expect(Object.keys(V2)).toEqual(
      expect.arrayContaining(['license', 'authors', 'generatedBy']),
    );
    const withOptionals: Manifest = { ...V2, translationOf: 'ban-goc', registryId: 'reg-1' };
    expect(withOptionals.translationOf).toBe('ban-goc');
    expect(withOptionals.registryId).toBe('reg-1');
  });

  it('là bội của v1: mọi trường v1 giữ nguyên tên và kiểu', () => {
    // If a v1 field were renamed or retyped, this object stops compiling — the
    // whole point of calling v2 a superset.
    const v1Fields: Pick<Manifest, 'id' | 'title' | 'description' | 'lang' | 'version' | 'runtime' | 'parts'> = V2;
    expect(v1Fields.parts[0]?.chapters[0]?.file).toBe('chapters/c1.html');
  });

  it('ba trường mới là BẮT BUỘC — bỏ trường nào cũng không biên dịch được', () => {
    // @ts-expect-error `license` is required in v2
    const noLicense: Manifest = { ...V2, license: undefined };
    // @ts-expect-error `authors` is required in v2
    const noAuthors: Manifest = { ...V2, authors: undefined };
    // @ts-expect-error `generatedBy` is required in v2
    const noGeneratedBy: Manifest = { ...V2, generatedBy: undefined };
    expect([noLicense, noAuthors, noGeneratedBy]).toHaveLength(3);
  });

  it('generatedBy là union đóng, không phải string', () => {
    const kinds: GeneratedBy[] = ['ai', 'human', 'mixed'];
    // @ts-expect-error only 'ai' | 'human' | 'mixed'
    const badKind: GeneratedBy = 'robot';
    expect([...kinds, badKind]).toHaveLength(4);
  });

  it('"tier" không còn biên dịch được trên Manifest — không chỉ vắng mặt ở V2', () => {
    // The regression this pins: someone re-adding `tier?: Tier` "for
    // compatibility" would make `V2` above still compile, but this line would
    // start compiling too, and the `@ts-expect-error` would go red with
    // "Unused directive" — the same gate `tsc -b` already runs in
    // `make test-format`.
    // @ts-expect-error format v2 killed `tier` — it is not a property of Manifest at all
    const withTier: Manifest = { ...V2, tier: 'content' };
    expect(withTier).toBeDefined();
  });
});

describe('parseManifest trả về kiểu Manifest thật', () => {
  it('nhánh thành công cho truy cập trường v2 mà không cần ép kiểu', () => {
    const r = parseManifest(JSON.stringify(V2));
    if (!('manifest' in r)) throw new Error(`expected a manifest, got ${r.error.code}`);
    const license: string = r.manifest.license;
    expect(license).toBe('CC-BY-4.0');
    expect(r.manifest.authors[0]?.name).toBe('A');
  });
});
