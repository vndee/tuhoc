import { describe, expect, it } from 'vitest';
import { parseManifest } from './validate';
import type { GeneratedBy, Manifest, Tier } from './types';

/**
 * These tests are half runtime, half **type gate**.
 *
 * The `@ts-expect-error` lines are the interesting half: each one asserts that
 * the compiler still rejects the code beneath it. If someone makes `tier`
 * optional, or widens `generatedBy` to `string`, the error disappears and
 * `bun run typecheck` (`tsc -b`) fails with "Unused '@ts-expect-error'
 * directive" — a red gate, not a silently-passing suite. Vitest itself does not
 * type-check, so these lines are inert at runtime by design; the value is in
 * `make test-format`'s sibling gate.
 */

const V2: Manifest = {
  id: 'demo',
  title: 'Demo',
  description: 'd',
  lang: 'vi',
  version: '1.0.0',
  runtime: '^1',
  tier: 'content',
  license: 'CC-BY-4.0',
  authors: [{ name: 'A' }, { name: 'B', url: 'https://example.org' }],
  generatedBy: 'human',
  parts: [{ title: 'P', chapters: [{ id: 'c1', num: '1', title: 'T', short: 'T', file: 'chapters/c1.html' }] }],
};

describe('Manifest v2', () => {
  it('mang đủ bốn trường mới cùng hai trường tuỳ chọn', () => {
    expect(Object.keys(V2)).toEqual(
      expect.arrayContaining(['tier', 'license', 'authors', 'generatedBy']),
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

  it('bốn trường mới là BẮT BUỘC — bỏ trường nào cũng không biên dịch được', () => {
    // @ts-expect-error `tier` is required in v2
    const noTier: Manifest = { ...V2, tier: undefined };
    // @ts-expect-error `license` is required in v2
    const noLicense: Manifest = { ...V2, license: undefined };
    // @ts-expect-error `authors` is required in v2
    const noAuthors: Manifest = { ...V2, authors: undefined };
    // @ts-expect-error `generatedBy` is required in v2
    const noGeneratedBy: Manifest = { ...V2, generatedBy: undefined };
    expect([noTier, noLicense, noAuthors, noGeneratedBy]).toHaveLength(4);
  });

  it('tier và generatedBy là union đóng, không phải string', () => {
    const tiers: Tier[] = ['content', 'interactive'];
    const kinds: GeneratedBy[] = ['ai', 'human', 'mixed'];
    // @ts-expect-error only 'content' | 'interactive'
    const badTier: Tier = 'CONTENT';
    // @ts-expect-error only 'ai' | 'human' | 'mixed'
    const badKind: GeneratedBy = 'robot';
    expect([...tiers, ...kinds, badTier, badKind]).toHaveLength(7);
  });
});

describe('parseManifest trả về kiểu Manifest thật', () => {
  it('nhánh thành công cho truy cập trường v2 mà không cần ép kiểu', () => {
    const r = parseManifest(JSON.stringify(V2));
    if (!('manifest' in r)) throw new Error(`expected a manifest, got ${r.error.code}`);
    const tier: Tier = r.manifest.tier;
    expect(tier).toBe('content');
    expect(r.manifest.authors[0]?.name).toBe('A');
  });
});
