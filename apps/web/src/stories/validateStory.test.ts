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

  it.each([14, 41, 20.5, Number.NaN])('rejects an invalid cable-route budget at its exact field: %s', (defaultBudget) => {
    const story = makeStoryFixture();
    story.scenes[0]!.lab = {
      kind: 'cable-route',
      title: { vi: 'Chọn tuyến', en: 'Choose a route' },
      instruction: { vi: 'So sánh', en: 'Compare' },
      config: { defaultBudget },
    } as unknown as typeof story.scenes[0]['lab'];

    expect(validateStory(story, new Set([...REGISTERED_LAB_KINDS, 'cable-route'] as never[])))
      .toContainEqual(expect.objectContaining({
        code: 'invalid-lab-config', path: 'scenes.0.lab.config.defaultBudget',
      }));
  });

  it.each([15, 28, 40])('accepts an integer cable-route budget within 15–40: %s', (defaultBudget) => {
    const story = makeStoryFixture();
    story.scenes[0]!.lab = {
      kind: 'cable-route',
      title: { vi: 'Chọn tuyến', en: 'Choose a route' },
      instruction: { vi: 'So sánh', en: 'Compare' },
      config: { defaultBudget },
    } as unknown as typeof story.scenes[0]['lab'];

    expect(validateStory(story, new Set([...REGISTERED_LAB_KINDS, 'cable-route'] as never[])))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-lab-config' })]));
  });

  it.each([0, 3, 5, 1.5, Number.NaN])('rejects an unsupported pulse-channel duration at its exact field: %s', (defaultDuration) => {
    const story = makeStoryFixture();
    story.scenes[0]!.lab = {
      kind: 'pulse-channel',
      title: { vi: 'Xung qua kênh', en: 'Pulses through a channel' },
      instruction: { vi: 'Quan sát xung', en: 'Observe the pulses' },
      config: { defaultDuration },
    } as unknown as typeof story.scenes[0]['lab'];

    expect(validateStory(story, new Set([...REGISTERED_LAB_KINDS, 'pulse-channel'] as never[])))
      .toContainEqual(expect.objectContaining({
        code: 'invalid-lab-config', path: 'scenes.0.lab.config.defaultDuration',
      }));
  });

  it.each([1, 2, 4])('accepts a supported pulse-channel duration: %s', (defaultDuration) => {
    const story = makeStoryFixture();
    story.scenes[0]!.lab = {
      kind: 'pulse-channel',
      title: { vi: 'Xung qua kênh', en: 'Pulses through a channel' },
      instruction: { vi: 'Quan sát xung', en: 'Observe the pulses' },
      config: { defaultDuration },
    } as unknown as typeof story.scenes[0]['lab'];

    expect(validateStory(story, new Set([...REGISTERED_LAB_KINDS, 'pulse-channel'] as never[])))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-lab-config' })]));
  });

  it.each([-0.01, 0.51, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid binary-noise probability at its exact field: %s',
    (defaultP) => {
      const story = makeStoryFixture();
      story.scenes[0]!.lab = {
        kind: 'binary-noise',
        title: { vi: 'Kênh nhiễu', en: 'Noisy channel' },
        instruction: { vi: 'Truyền', en: 'Transmit' },
        config: { defaultP, seed: 20260905 },
      } as unknown as typeof story.scenes[0]['lab'];

      expect(validateStory(story, new Set([...REGISTERED_LAB_KINDS, 'binary-noise'] as never[])))
        .toContainEqual(expect.objectContaining({
          code: 'invalid-lab-config', path: 'scenes.0.lab.config.defaultP',
        }));
    },
  );

  it.each([-1, 0.5, 0x1_0000_0000, Number.NaN])(
    'rejects an invalid binary-noise seed at its exact field: %s',
    (seed) => {
      const story = makeStoryFixture();
      story.scenes[0]!.lab = {
        kind: 'binary-noise',
        title: { vi: 'Kênh nhiễu', en: 'Noisy channel' },
        instruction: { vi: 'Truyền', en: 'Transmit' },
        config: { defaultP: 0.05, seed },
      } as unknown as typeof story.scenes[0]['lab'];

      expect(validateStory(story, new Set([...REGISTERED_LAB_KINDS, 'binary-noise'] as never[])))
        .toContainEqual(expect.objectContaining({
          code: 'invalid-lab-config', path: 'scenes.0.lab.config.seed',
        }));
    },
  );

  it.each([
    { config: { defaultBudget: 511, defaultP: 0.05, seed: 20260905 }, path: 'defaultBudget' },
    { config: { defaultBudget: 513, defaultP: 0.05, seed: 20260905 }, path: 'defaultBudget' },
    { config: { defaultBudget: 33280, defaultP: 0.05, seed: 20260905 }, path: 'defaultBudget' },
    { config: { defaultBudget: 4096, defaultP: 0.051, seed: 20260905 }, path: 'defaultP' },
    { config: { defaultBudget: 4096, defaultP: -0.01, seed: 20260905 }, path: 'defaultP' },
    { config: { defaultBudget: 4096, defaultP: 0.05, seed: 0x1_0000_0000 }, path: 'seed' },
  ])('rejects invalid channel-budget config at its exact $path field', ({ config, path }) => {
    const story = makeStoryFixture();
    story.scenes[0]!.lab = {
      kind: 'channel-budget', title: { vi: 'Ngân sách', en: 'Budget' },
      instruction: { vi: 'Truyền', en: 'Transmit' }, config,
    } as unknown as typeof story.scenes[0]['lab'];

    expect(validateStory(story, new Set([...REGISTERED_LAB_KINDS, 'channel-budget'] as never[])))
      .toContainEqual(expect.objectContaining({
        code: 'invalid-lab-config', path: `scenes.0.lab.config.${path}`,
      }));
  });

  it('accepts exact channel-budget limits and hundredth-step probabilities', () => {
    for (const config of [
      { defaultBudget: 512, defaultP: 0, seed: 0 },
      { defaultBudget: 32768, defaultP: 0.5, seed: 0xffff_ffff },
    ]) {
      const story = makeStoryFixture();
      story.scenes[0]!.lab = {
        kind: 'channel-budget', title: { vi: 'Ngân sách', en: 'Budget' },
        instruction: { vi: 'Truyền', en: 'Transmit' }, config,
      } as unknown as typeof story.scenes[0]['lab'];
      expect(validateStory(story, new Set([...REGISTERED_LAB_KINDS, 'channel-budget'] as never[])))
        .not.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-lab-config' })]));
    }
  });

  it('accepts exactly the three localized message-meaning contexts', () => {
    const story = makeStoryFixture();
    story.scenes[0]!.lab = {
      kind: 'message-meaning', title: { vi: 'Ý nghĩa', en: 'Meaning' },
      instruction: { vi: 'Suy ngẫm', en: 'Reflect' },
      config: { contexts: [
        { id: 'meeting', label: { vi: 'Cuộc gặp', en: 'Meeting' } },
        { id: 'disagreement', label: { vi: 'Bất đồng', en: 'Disagreement' } },
        { id: 'missing-previous', label: { vi: 'Thiếu tin trước', en: 'Missing previous' } },
      ] },
    } as unknown as typeof story.scenes[0]['lab'];

    expect(validateStory(story, new Set([...REGISTERED_LAB_KINDS, 'message-meaning'] as never[])))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-lab-config' })]));
    expect(validateStory(story, new Set([...REGISTERED_LAB_KINDS, 'message-meaning'] as never[])))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'missing-locale' })]));
  });

  it.each([
    {
      contexts: [
        { id: 'meeting', label: { vi: 'Cuộc gặp', en: 'Meeting' } },
        { id: 'disagreement', label: { vi: 'Bất đồng', en: 'Disagreement' } },
      ],
      code: 'invalid-lab-config', path: 'scenes.0.lab.config.contexts',
    },
    {
      contexts: [
        { id: 'meeting', label: { vi: 'Cuộc gặp', en: 'Meeting' } },
        { id: 'meeting', label: { vi: 'Cuộc gặp lại', en: 'Meeting again' } },
        { id: 'missing-previous', label: { vi: 'Thiếu tin trước', en: 'Missing previous' } },
      ],
      code: 'duplicate-id', path: 'scenes.0.lab.config.contexts.1.id',
    },
    {
      contexts: [
        { id: 'unexpected', label: { vi: 'Lạ', en: 'Unexpected' } },
        { id: 'disagreement', label: { vi: 'Bất đồng', en: 'Disagreement' } },
        { id: 'missing-previous', label: { vi: 'Thiếu tin trước', en: 'Missing previous' } },
      ],
      code: 'invalid-lab-config', path: 'scenes.0.lab.config.contexts.0.id',
    },
    {
      contexts: [
        { id: 'meeting', label: { vi: 'Cuộc gặp', en: 'Meeting' } },
        { id: 'disagreement', label: { vi: 'Bất đồng', en: '' } },
        { id: 'missing-previous', label: { vi: 'Thiếu tin trước', en: 'Missing previous' } },
      ],
      code: 'missing-locale', path: 'scenes.0.lab.config.contexts.1.label.en',
    },
  ])('rejects an invalid message-meaning context contract at $path', ({ contexts, code, path }) => {
    const story = makeStoryFixture();
    story.scenes[0]!.lab = {
      kind: 'message-meaning', title: { vi: 'Ý nghĩa', en: 'Meaning' },
      instruction: { vi: 'Suy ngẫm', en: 'Reflect' }, config: { contexts },
    } as unknown as typeof story.scenes[0]['lab'];

    expect(validateStory(story, new Set([...REGISTERED_LAB_KINDS, 'message-meaning'] as never[])))
      .toContainEqual(expect.objectContaining({ code, path }));
  });

  it.each(['', '101', '10110', '10a1', ' 1011', 1011, ['1011']])('rejects invalid secded-inspector data at its exact field: %j', (data) => {
    const story = makeStoryFixture();
    story.scenes[0]!.lab = {
      kind: 'secded-inspector',
      title: { vi: 'Tìm vị trí cần sửa', en: 'Locating the Bit to Repair' },
      instruction: { vi: 'Đọc phép kiểm tra', en: 'Read the parity checks' },
      config: { data },
    } as unknown as typeof story.scenes[0]['lab'];

    expect(validateStory(story, new Set([...REGISTERED_LAB_KINDS, 'secded-inspector'] as never[])))
      .toContainEqual(expect.objectContaining({
        code: 'invalid-lab-config', path: 'scenes.0.lab.config.data',
      }));
  });

  it('accepts exactly four binary characters for secded-inspector', () => {
    const story = makeStoryFixture();
    story.scenes[0]!.lab = {
      kind: 'secded-inspector',
      title: { vi: 'Tìm vị trí cần sửa', en: 'Locating the Bit to Repair' },
      instruction: { vi: 'Đọc phép kiểm tra', en: 'Read the parity checks' },
      config: { data: '1011' },
    } as unknown as typeof story.scenes[0]['lab'];

    expect(validateStory(story, new Set([...REGISTERED_LAB_KINDS, 'secded-inspector'] as never[])))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-lab-config' })]));
  });

  it.each([
    { defaultP: 0, seed: 0 },
    { defaultP: 0.05, seed: 20260905 },
    { defaultP: 0.5, seed: 0xffff_ffff },
  ])('accepts binary-noise config $defaultP/$seed', (config) => {
    const story = makeStoryFixture();
    story.scenes[0]!.lab = {
      kind: 'binary-noise',
      title: { vi: 'Kênh nhiễu', en: 'Noisy channel' },
      instruction: { vi: 'Truyền', en: 'Transmit' },
      config,
    } as unknown as typeof story.scenes[0]['lab'];

    expect(validateStory(story, new Set([...REGISTERED_LAB_KINDS, 'binary-noise'] as never[])))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-lab-config' })]));
  });

  it.each([
    { weights: [25, 25, 25] },
    { weights: [25, 25, 25, 25, 25] },
    { weights: [25, -1, 25, 25] },
    { weights: [25, 0.5, 25, 25] },
    { weights: [25, 101, 25, 25] },
    { weights: [0, 0, 0, 0] },
  ])('rejects an invalid source-entropy weight tuple: $weights', ({ weights }) => {
    const story = makeStoryFixture();
    story.scenes[0]!.lab = {
      kind: 'source-entropy',
      title: { vi: 'Entropy nguồn', en: 'Source entropy' },
      instruction: { vi: 'Rút ký hiệu', en: 'Draw a symbol' },
      config: { weights, seed: 20260905 },
    } as unknown as typeof story.scenes[0]['lab'];

    expect(validateStory(story, new Set([...REGISTERED_LAB_KINDS, 'source-entropy'] as never[])))
      .toContainEqual(expect.objectContaining({
        code: 'invalid-lab-config', path: 'scenes.0.lab.config.weights',
      }));
  });

  it('rejects a sparse source-entropy weight tuple', () => {
    const story = makeStoryFixture();
    const weights = [25, 25, 25, 25];
    delete weights[2];
    story.scenes[0]!.lab = {
      kind: 'source-entropy',
      title: { vi: 'Entropy nguồn', en: 'Source entropy' },
      instruction: { vi: 'Rút ký hiệu', en: 'Draw a symbol' },
      config: { weights, seed: 20260905 },
    } as unknown as typeof story.scenes[0]['lab'];

    expect(validateStory(story, new Set([...REGISTERED_LAB_KINDS, 'source-entropy'] as never[])))
      .toContainEqual(expect.objectContaining({
        code: 'invalid-lab-config', path: 'scenes.0.lab.config.weights',
      }));
  });

  it.each([-1, 0.5, 0x1_0000_0000, Number.NaN])(
    'rejects an invalid source-entropy seed at its exact field: %s',
    (seed) => {
      const story = makeStoryFixture();
      story.scenes[0]!.lab = {
        kind: 'source-entropy',
        title: { vi: 'Entropy nguồn', en: 'Source entropy' },
        instruction: { vi: 'Rút ký hiệu', en: 'Draw a symbol' },
        config: { weights: [25, 25, 25, 25], seed },
      } as unknown as typeof story.scenes[0]['lab'];

      expect(validateStory(story, new Set([...REGISTERED_LAB_KINDS, 'source-entropy'] as never[])))
        .toContainEqual(expect.objectContaining({
          code: 'invalid-lab-config', path: 'scenes.0.lab.config.seed',
        }));
    },
  );

  it('accepts source-entropy integer weights and a uint32 seed', () => {
    const story = makeStoryFixture();
    story.scenes[0]!.lab = {
      kind: 'source-entropy',
      title: { vi: 'Entropy nguồn', en: 'Source entropy' },
      instruction: { vi: 'Rút ký hiệu', en: 'Draw a symbol' },
      config: { weights: [0, 100, 2, 3], seed: 0xffff_ffff },
    } as unknown as typeof story.scenes[0]['lab'];

    expect(validateStory(story, new Set([...REGISTERED_LAB_KINDS, 'source-entropy'] as never[])))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-lab-config' })]));
  });

  it.each([0, 1.5, 33, Number.NaN])(
    'rejects invalid huffman-message maxVisibleNodes at its exact field: %s',
    (maxVisibleNodes) => {
      const story = makeStoryFixture();
      story.scenes[0]!.lab = {
        kind: 'huffman-message',
        title: { vi: 'Nén', en: 'Compress' },
        instruction: { vi: 'Tính cả gói', en: 'Count the whole packet' },
        config: { maxVisibleNodes },
      } as unknown as typeof story.scenes[0]['lab'];

      expect(validateStory(story, new Set([...REGISTERED_LAB_KINDS, 'huffman-message'] as never[])))
        .toContainEqual(expect.objectContaining({
          code: 'invalid-lab-config', path: 'scenes.0.lab.config.maxVisibleNodes',
        }));
    },
  );

  it.each([1, 24, 32])('accepts huffman-message maxVisibleNodes %s', (maxVisibleNodes) => {
    const story = makeStoryFixture();
    story.scenes[0]!.lab = {
      kind: 'huffman-message',
      title: { vi: 'Nén', en: 'Compress' },
      instruction: { vi: 'Tính cả gói', en: 'Count the whole packet' },
      config: { maxVisibleNodes },
    } as unknown as typeof story.scenes[0]['lab'];

    expect(validateStory(story, new Set([...REGISTERED_LAB_KINDS, 'huffman-message'] as never[])))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-lab-config' })]));
  });

  it.each([-0.01, 0.51, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid repetition-channel probability at its exact field: %s',
    (defaultP) => {
      const story = makeStoryFixture();
      story.scenes[0]!.lab = {
        kind: 'repetition-channel',
        title: { vi: 'Gửi ba lần', en: 'Three copies' },
        instruction: { vi: 'So sánh', en: 'Compare' },
        config: { defaultP, seed: 20260905 },
      } as unknown as typeof story.scenes[0]['lab'];

      expect(validateStory(story, new Set([...REGISTERED_LAB_KINDS, 'repetition-channel'] as never[])))
        .toContainEqual(expect.objectContaining({
          code: 'invalid-lab-config', path: 'scenes.0.lab.config.defaultP',
        }));
    },
  );

  it.each([-1, 0.5, 0x1_0000_0000, Number.NaN])(
    'rejects an invalid repetition-channel seed at its exact field: %s',
    (seed) => {
      const story = makeStoryFixture();
      story.scenes[0]!.lab = {
        kind: 'repetition-channel',
        title: { vi: 'Gửi ba lần', en: 'Three copies' },
        instruction: { vi: 'So sánh', en: 'Compare' },
        config: { defaultP: 0.05, seed },
      } as unknown as typeof story.scenes[0]['lab'];

      expect(validateStory(story, new Set([...REGISTERED_LAB_KINDS, 'repetition-channel'] as never[])))
        .toContainEqual(expect.objectContaining({
          code: 'invalid-lab-config', path: 'scenes.0.lab.config.seed',
        }));
    },
  );

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
