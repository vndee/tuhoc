import { describe, expect, it } from 'vitest';
import { REGISTERED_LAB_KINDS } from './labs/registry';
import { makeStoryFixture } from './testing/storyFixture';
import { validateStory } from './validateStory';

describe('validateStory', () => {
  it('accepts a complete bilingual story', () => {
    expect(validateStory(makeStoryFixture(), REGISTERED_LAB_KINDS)).toEqual([]);
  });

  it('uses the production lab registry when no test registry is injected', () => {
    expect(validateStory(makeStoryFixture())).toEqual([]);
  });

  it('reports a blank English message example at its exact field', () => {
    const story = Object.assign(makeStoryFixture(), {
      interaction: { kind: 'message-journey' as const, examples: { vi: 'Xin chào', en: '' } },
    });

    expect(validateStory(story, REGISTERED_LAB_KINDS)).toContainEqual(expect.objectContaining({
      code: 'missing-locale', path: 'interaction.examples.en',
    }));
  });

  it.each([
    ['overlong', 'a'.repeat(121)],
    ['ill-formed', '\ud800'],
  ])('reports an %s message example at its exact field', (_name, example) => {
    const story = Object.assign(makeStoryFixture(), {
      interaction: { kind: 'message-journey' as const, examples: { vi: example, en: 'Hello' } },
    });

    expect(validateStory(story, REGISTERED_LAB_KINDS)).toContainEqual(expect.objectContaining({
      code: 'invalid-story-interaction', path: 'interaction.examples.vi',
    }));
  });

  it('reports a blank intro block at its exact field', () => {
    const story = Object.assign(makeStoryFixture(), {
      intro: {
        vi: [{ kind: 'paragraph' as const, text: 'Lời mở đầu.' }],
        en: [{ kind: 'paragraph' as const, text: ' ' }],
      },
    });

    expect(validateStory(story, REGISTERED_LAB_KINDS)).toContainEqual(expect.objectContaining({
      code: 'missing-locale', path: 'intro.en.0.text',
    }));
  });

  it('reports an empty course action slug at its exact field', () => {
    const story = Object.assign(makeStoryFixture(), {
      courseAction: {
        slug: '',
        label: { vi: 'Tiếp tục học', en: 'Keep learning' },
        fallbackLabel: { vi: 'Xem khóa học', en: 'View course' },
      },
    });

    expect(validateStory(story, REGISTERED_LAB_KINDS)).toContainEqual(expect.objectContaining({
      code: 'missing-locale', path: 'courseAction.slug',
    }));
  });

  it('reports fallback table row-width mismatches and blank English cells at exact fields', () => {
    const story = makeStoryFixture();
    Object.assign(story.scenes[0]!.labFallback, {
      table: {
        vi: { headers: ['Cột một', 'Cột hai'], rows: [['Chỉ một ô']] },
        en: { headers: ['Column one', 'Column two'], rows: [['Value', '']] },
      },
    });

    expect(validateStory(story, REGISTERED_LAB_KINDS)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'invalid-fallback-table', path: 'scenes.0.labFallback.table.vi.rows.0',
      }),
      expect.objectContaining({
        code: 'missing-locale', path: 'scenes.0.labFallback.table.en.rows.0.1',
      }),
    ]));
  });

  it('reports an unsupported interaction structure at its discriminant', () => {
    const story = Object.assign(makeStoryFixture(), {
      interaction: { kind: 'unsupported', examples: { vi: 'Xin chào', en: 'Hello' } },
    });

    expect(validateStory(story as Parameters<typeof validateStory>[0], REGISTERED_LAB_KINDS)).toContainEqual(expect.objectContaining({
      code: 'invalid-story-interaction', path: 'interaction.kind',
    }));
  });

  it.each([
    ['duplicate scene id', (story: ReturnType<typeof makeStoryFixture>) => story.scenes.push(story.scenes[0])],
    ['missing source', (story: ReturnType<typeof makeStoryFixture>) => story.scenes[0].sourceIds.push('missing')],
    ['wrong scene count', (story: ReturnType<typeof makeStoryFixture>) => { story.meta.sceneCount = 2; }],
    ['missing English alt', (story: ReturnType<typeof makeStoryFixture>) => { story.scenes[0].illustration.alt.en = ''; }],
    ['missing fallback copy', (story: ReturnType<typeof makeStoryFixture>) => { story.scenes[0].labFallback.explanation.vi = ''; }],
  ])('rejects %s', (_name, breakStory) => {
    const story = makeStoryFixture();
    breakStory(story);
    expect(validateStory(story, REGISTERED_LAB_KINDS)).not.toEqual([]);
  });

  it('rejects an unregistered lab and a featured unpublished issue', () => {
    const story = makeStoryFixture();
    story.meta.published = false;
    story.meta.featured = true;
    expect(validateStory(story, new Set())).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'featured-unpublished' }),
      expect.objectContaining({ code: 'unknown-lab-kind' }),
    ]));
  });

  it('rejects duplicate source references even when the source count is valid', () => {
    const story = makeStoryFixture();
    story.scenes[0].sourceIds = ['source-a', 'source-a'];

    expect(validateStory(story, REGISTERED_LAB_KINDS)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate-id', path: 'scenes.0.sourceIds' }),
    ]));
  });

  it.each([-1, 6])('rejects an AGI definition coordinate outside 0–5: %s', (generality) => {
    const story = makeStoryFixture();
    story.scenes[0]!.lab = {
      kind: 'agi-definitions',
      title: { vi: 'Khung AGI', en: 'AGI frames' },
      instruction: { vi: 'So sánh', en: 'Compare' },
      config: { definitions: [
        { id: 'one', label: { vi: 'Một', en: 'One' }, sourceId: 'source-a', sourceLabel: { vi: 'Nguồn A', en: 'Source A' }, note: { vi: 'Ghi chú', en: 'A note' }, generality, capability: 2, autonomy: 3 },
        { id: 'two', label: { vi: 'Hai', en: 'Two' }, sourceId: 'source-b', sourceLabel: { vi: 'Nguồn B', en: 'Source B' }, note: { vi: 'Ghi chú', en: 'A note' }, generality: 4, capability: 2, autonomy: 3 },
      ] },
    };

    expect(validateStory(story, REGISTERED_LAB_KINDS)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid-lab-config', path: 'scenes.0.lab.config.definitions.0.generality' }),
    ]));
  });

  it.each([0, 29, 31, 61, Number.NaN])('rejects an unsupported message budget at its exact field: %s', (defaultBudget) => {
    const story = makeStoryFixture();
    story.scenes[0]!.lab = {
      kind: 'message-budget',
      title: { vi: 'Giữ lời', en: 'Keep the meaning' },
      instruction: { vi: 'Rút gọn', en: 'Shorten' },
      config: { defaultBudget },
    } as typeof story.scenes[0]['lab'];

    expect(validateStory(story, REGISTERED_LAB_KINDS)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid-lab-config', path: 'scenes.0.lab.config.defaultBudget' }),
    ]));
  });

  it.each([
    [{ A: '', B: '01', C: '1', D: '11' }, 'B', 'scenes.0.lab.config.initialBook.A'],
    [{ A: '0', B: '012', C: '1', D: '11' }, 'B', 'scenes.0.lab.config.initialBook.B'],
    [{ A: '0', B: '01', C: '1', D: '1111111' }, 'B', 'scenes.0.lab.config.initialBook.D'],
    [{ A: '0', B: '01', C: '1', D: '11' }, '', 'scenes.0.lab.config.initialSymbols'],
    [{ A: '0', B: '01', C: '1', D: '11' }, 'ABX', 'scenes.0.lab.config.initialSymbols'],
    [{ A: '0', B: '01', C: '1', D: '11' }, 'AAAAAAA', 'scenes.0.lab.config.initialSymbols'],
  ])('rejects invalid ambiguous-code config at its exact field', (initialBook, initialSymbols, path) => {
    const story = makeStoryFixture();
    story.scenes[0]!.lab = {
      kind: 'ambiguous-code',
      title: { vi: 'Mã nhập nhằng', en: 'Ambiguous code' },
      instruction: { vi: 'Giải mã', en: 'Decode' },
      config: { initialBook, initialSymbols },
    } as unknown as typeof story.scenes[0]['lab'];

    expect(validateStory(story, REGISTERED_LAB_KINDS)).toContainEqual(expect.objectContaining({
      code: 'invalid-lab-config', path,
    }));
  });

  it('accepts duplicate codewords in ambiguous-code config', () => {
    const story = makeStoryFixture();
    story.scenes[0]!.lab = {
      kind: 'ambiguous-code',
      title: { vi: 'Mã nhập nhằng', en: 'Ambiguous code' },
      instruction: { vi: 'Giải mã', en: 'Decode' },
      config: { initialBook: { A: '0', B: '0', C: '0', D: '0' }, initialSymbols: 'AB' },
    } as unknown as typeof story.scenes[0]['lab'];

    expect(validateStory(story, new Set([...REGISTERED_LAB_KINDS, 'ambiguous-code'] as never[])))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-lab-config' })]));
  });

  it.each(['', 'SOS', 'beam', 'ET '])('rejects an unsupported morse-spacing example at its exact field: %j', (example) => {
    const story = makeStoryFixture();
    story.scenes[0]!.lab = {
      kind: 'morse-spacing',
      title: { vi: 'Đọc cả khoảng lặng', en: 'Reading the Gaps' },
      instruction: { vi: 'Đổi khoảng nghỉ', en: 'Change the pauses' },
      config: { example },
    } as unknown as typeof story.scenes[0]['lab'];

    expect(validateStory(story, REGISTERED_LAB_KINDS)).toContainEqual(expect.objectContaining({
      code: 'invalid-lab-config', path: 'scenes.0.lab.config.example',
    }));
  });

  it('reports each invalid image, source, provenance, and source reference at its exact path', () => {
    const story = makeStoryFixture();
    story.scenes[0].illustration.src = '';
    story.sources[0].url = 'not a URL';
    story.provenance[1].filename = '';
    story.scenes[0].sourceIds.push('missing');

    expect(validateStory(story, REGISTERED_LAB_KINDS)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing-image-metadata', path: 'scenes.0.illustration.src' }),
      expect.objectContaining({ code: 'invalid-source', path: 'sources.0.url' }),
      expect.objectContaining({ code: 'missing-provenance', path: 'provenance.1.filename' }),
      expect.objectContaining({ code: 'missing-source', path: 'scenes.0.sourceIds.2' }),
    ]));
  });
});
