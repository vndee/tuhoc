import { describe, expect, it } from 'vitest';
import { makeStoryFixture } from '../../testing/storyFixture';
import { validateStory } from '../../validateStory';
import { issueCopy } from './copy';
import { noiseLabs } from './labs';
import { noiseFallbacks } from './fallbacks';
import { noiseSources } from './sources';
import { compareDraft } from '../../labs/message-budget/model';
import { decodePaths } from '../../labs/ambiguous-code/model';
import { morseTimeline, readMorse } from '../../labs/morse-spacing/model';
import { routeCost } from '../../labs/cable-route/model';
import { simulatePulses } from '../../labs/pulse-channel/model';
import { manualNoise } from '../../labs/binary-noise/model';
import { sourceEntropy } from '../../labs/source-entropy/model';
import { encodeHuffman, decodeHuffman } from '../../labs/huffman-message/codec';
import { decodeRepeat3 } from '../../labs/communication/repetition';
import { inspectSecded } from '../../labs/secded-inspector/model';
import { channelRequirement, runTransmission } from '../../labs/channel-budget/model';
import type { Result } from '../../labs/communication/types';
import type { SceneId } from '../../types';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { StaticLabFallback } from '../../components/StaticLabFallback';

function value<T>(result: Result<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
const rows = (id: SceneId, lang: 'vi' | 'en' = 'en') => noiseFallbacks[id].table![lang].rows;

describe('Across the Noise static content', () => {
  it.each(['vi', 'en'] as const)('renders every static table and the five actual diagrams in %s', lang => {
    render(createElement('div', {}, ...Object.entries(noiseFallbacks).map(([id, fallback]) => {
      const lab = noiseLabs[id as SceneId];
      return createElement(StaticLabFallback, { key: id, fallback, lang, title: lab.title[lang], instruction: lab.instruction[lang], onRetry: () => undefined, onBack: () => undefined });
    })));
    expect(screen.getAllByRole('table')).toHaveLength(12);
    expect(screen.getAllByRole('img')).toHaveLength(5);
    for (const id of ['scene-02', 'scene-03', 'scene-04', 'scene-05', 'scene-08'] as const) {
      const diagram = noiseFallbacks[id].diagram!;
      const svg = screen.getByRole('img', { name: diagram.title[lang] });
      expect(svg.querySelectorAll('polyline').length).toBeGreaterThanOrEqual(2);
      expect(svg).toHaveAccessibleDescription(diagram.description[lang]);
      expect(svg.querySelector('text')).not.toBeNull();
    }
  });
  it('pairs twelve explicit scenes with the approved kinds, sources and localized fallback tables', () => {
    const ids = ['scene-01', 'scene-02', 'scene-03', 'scene-04', 'scene-05', 'scene-06', 'scene-07', 'scene-08', 'scene-09', 'scene-10', 'scene-11', 'scene-12'];
    expect(Object.keys(noiseLabs)).toEqual(ids);
    expect(Object.keys(noiseFallbacks)).toEqual(ids);
    expect(Object.values(noiseLabs).map(lab => lab.kind)).toEqual(['message-budget', 'ambiguous-code', 'morse-spacing', 'cable-route', 'pulse-channel', 'binary-noise', 'source-entropy', 'huffman-message', 'repetition-channel', 'secded-inspector', 'channel-budget', 'message-meaning']);
    expect(noiseSources.map(source => source.id)).toEqual(['morse-tape', 'morse-archive', 'itu-morse', 'cable-history', 'cable-object', 'cable-workers', 'shannon-1948', 'mit-isi', 'huffman-1952', 'hamming-1950', 'mit-code', 'ibm-repetition', 'mit-capacity', 'unicode-segmentation', 'unicode-normalization']);
    for (const [id, scene] of Object.entries(issueCopy.scenes)) {
      expect(scene.sourceIds.length).toBeGreaterThanOrEqual(2);
      expect(scene.sourceIds.length).toBeLessThanOrEqual(4);
      for (const sourceId of scene.sourceIds) expect(noiseSources.some(source => source.id === sourceId)).toBe(true);
      const fallback = noiseFallbacks[id as keyof typeof noiseFallbacks];
      for (const lang of ['vi', 'en'] as const) {
        expect(fallback.diagramLabel[lang]).toMatch(lang === 'vi' ? /Ví dụ tĩnh/ : /Static example/);
        expect(fallback.explanation[lang].trim()).not.toBe('');
        const table = fallback.table?.[lang];
        expect(table).toBeDefined();
        expect(table!.headers.length).toBeGreaterThan(1);
        expect(table!.rows.length).toBeGreaterThan(1);
        for (const row of table!.rows) {
          expect(row).toHaveLength(table!.headers.length);
          for (const cell of row) expect(cell.trim()).not.toBe('');
        }
      }
    }
  });

  it('passes the story validator with existing test-only image fixtures', () => {
    const story = makeStoryFixture({ sceneCount: 12 });
    story.sources = noiseSources;
    story.acts = issueCopy.acts;
    story.intro = issueCopy.intro;
    story.coda = issueCopy.coda;
    story.courseAction = issueCopy.courseAction;
    story.scenes.forEach((scene, index) => {
      const id = issueCopy.acts.flatMap(act => act.sceneIds)[index];
      story.provenance.find(record => record.sceneId === scene.id)!.sceneId = id;
      Object.assign(scene, issueCopy.scenes[id], {
        id, actId: issueCopy.acts[Math.floor(index / 3)].id,
        lab: noiseLabs[id], labFallback: noiseFallbacks[id],
      });
    });
    expect(validateStory(story)).toEqual([]);
  });

  it('counts the two shortened examples per locale without claiming the Vietnamese drafts fit 15', () => {
    for (const lang of ['vi', 'en'] as const) {
      const table = rows('scene-01', lang);
      for (const row of table) {
        const comparison = value(compareDraft(table[0][1], row[1], 15));
        expect(row.slice(2).map(Number)).toEqual([comparison.shortenedGraphemes, comparison.shortenedBytes, comparison.over]);
      }
    }
    expect(rows('scene-01', 'vi').slice(1).map(row => Number(row[4]))).toEqual([1, 3]);
  });

  it('keeps numeric fixtures identical across both localized tables', () => {
    const numericColumns: Record<SceneId, number[]> = {
      'scene-02': [1], 'scene-03': [1, 2, 3], 'scene-04': [1, 2, 3, 4, 5, 6, 7],
      'scene-05': [0, 1, 2, 3, 4, 5], 'scene-06': [1, 2, 3, 5, 6],
      'scene-07': [0, 1, 2, 3], 'scene-08': [1, 2, 3, 4, 5, 6, 7],
      'scene-09': [0, 1, 2, 3, 4, 6], 'scene-10': [0, 1, 3, 4, 5],
      'scene-11': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    };
    for (const [id, columns] of Object.entries(numericColumns)) {
      const select = (lang: 'vi' | 'en') => rows(id as SceneId, lang).map(row => columns.map(column => row[column]));
      expect(select('vi')).toEqual(select('en'));
    }
  });

  it('matches both decoding branches and every timed mark/space segment', () => {
    const decoding = value(decodePaths('01', { A: '0', B: '01', C: '1', D: '11' }));
    expect(decoding).toEqual({ count: '2', readings: ['AC', 'B'], truncated: false });
    expect(rows('scene-02').map(row => row.slice(0, 2))).toEqual([['A', '0'], ['B', '01'], ['C', '1'], ['D', '11']]);
    const branch = noiseFallbacks['scene-02'].diagram!;
    expect(branch.lines.map(line => line.points)).toEqual([[[180, 35], [80, 95], [80, 165]], [[180, 35], [280, 95], [280, 165]]]);
    expect(branch.labels.slice(-1)[0].text.en).toBe(decoding.readings[1]);
    const strips = noiseFallbacks['scene-03'].diagram!.lines;
    for (const [index, row] of rows('scene-03').entries()) {
      const segments = value(morseTimeline(row[0], Number(row[2]), 7));
      expect(segments.map(segment => segment.duration)).toEqual(row.slice(1, 4).map(Number));
      expect(value(readMorse(segments))).toBe(row[4]);
      const points = strips[index].points;
      expect([(points[2][0] - points[1][0]) / 50, (points[4][0] - points[3][0]) / 50, (points[6][0] - points[5][0]) / 50]).toEqual(segments.map(segment => segment.duration));
    }
  });

  it('matches fictional route costs and profile lengths, hard cells and deep cells', () => {
    const diagram = noiseFallbacks['scene-04'].diagram!;
    for (const [index, id] of (['north', 'middle', 'south'] as const).entries()) {
      const cost = routeCost(id);
      const row = rows('scene-04')[index];
      expect(row.slice(1, 4).map(Number)).toEqual([cost.length, cost.hard, cost.deep]);
      expect(row[4]).toBe(cost.components.join(' + '));
      expect(Number(row[5])).toBe(cost.total);
      expect(Number(row[7])).toBe(Math.max(0, cost.total - Number(row[6])));
      const cells = diagram.lines.filter(line => line.label.en.startsWith(`${row[0]}: segment `));
      expect(cells).toHaveLength(cost.length);
      expect(cells.filter(line => line.style === 'dashed')).toHaveLength(cost.hard);
      expect(cells.filter(line => line.points[0][1] === 290 + index * 85)).toHaveLength(cost.deep);
    }
  });

  it('matches the separate pulse samples and both complete authored input/output traces', () => {
    const diagram = noiseFallbacks['scene-05'].diagram!;
    for (const [panel, duration] of ([4, 1] as const).entries()) {
      const result = value(simulatePulses([0, 1, 0, 1], { duration, tau: 2, sampleFraction: 0.5 }));
      const table = rows('scene-05').slice(panel * 4, panel * 4 + 4);
      for (const [index, sample] of result.samples.entries()) {
        expect(table[index].map(Number).filter((_n, col) => col !== 2)).toEqual([duration, sample.time, sample.sent, sample.received, result.errors]);
        expect(Number(table[index][2])).toBeCloseTo(sample.value, 6);
      }
      const input = diagram.lines[panel * 7];
      const output = diagram.lines[panel * 7 + 1];
      expect(input.style).toBe('solid');
      expect(output.style).toBe('dashed');
      expect(input.points).toHaveLength(8);
      const center = 100 + panel * 190;
      expect(input.points.map(point => (center - point[1]) / 40)).toEqual([-1, -1, 1, 1, -1, -1, 1, 1]);
      expect(output.points).toHaveLength(33);
      for (const [x, y] of output.points) {
        const time = (x - 40) * duration / 100;
        const modelPoint = result.points.find(point => point.time === time)!;
        expect((center - y) / 40).toBeCloseTo(modelPoint.output, 6);
      }
      for (const [index, sample] of result.samples.entries()) {
        const marker = diagram.lines[panel * 7 + 3 + index].points[2];
        expect((marker[0] - 40) * duration / 100).toBe(sample.time);
        expect((center - marker[1]) / 40).toBeCloseTo(sample.value, 6);
      }
    }
  });

  it('shows both readable corruption and invalid UTF-8 after a single flipped bit', () => {
    rows('scene-06').forEach((row, index) => {
      const result = value(manualNoise([65], [Number(row[1]) - 1]));
      expect(result.received).toEqual([Number(row[2])]);
      expect(result.received[0].toString(2).padStart(8, '0')).toBe(row[3]);
      expect([result.errors, result.ber]).toEqual(row.slice(5, 7).map(Number));
      expect(result.exact).toBe(false);
      expect(result.decoded.ok).toBe(index === 1);
      if (result.decoded.ok) expect(result.decoded.value).toBe(row[4]);
    });
  });

  it('shows complete probability/contribution rows at entropy zero and two', () => {
    for (const [index, weights] of ([[1, 0, 0, 0], [1, 1, 1, 1]] as const).entries()) {
      const result = value(sourceEntropy(weights));
      const row = rows('scene-07')[index];
      expect(row[0].split(',').map(Number)).toEqual(weights);
      expect(row[1].split(',').map(Number)).toEqual(result.probabilities);
      expect(row[2].split(',').map(Number)).toEqual(result.contributions);
      expect(Number(row[3])).toBe(result.entropy);
    }
  });

  it('keeps the four-leaf tree and code lengths separate from the single-symbol 96-bit packet', () => {
    for (const row of rows('scene-08')) {
      const bytes = Array.from(new TextEncoder().encode(row[0]));
      const packet = value(encodeHuffman(bytes));
      expect(row.slice(2, 7).map(Number)).toEqual([bytes.length * 8, packet.payloadBits, packet.headerBits, packet.paddingBits, packet.totalBits]);
      expect(row[1]).toBe(packet.codes.map(code => `0x${code.byte.toString(16).toUpperCase()}: ${code.code} (${code.code.length})`).join('; '));
      expect(value(decodeHuffman(JSON.parse(JSON.stringify(packet.container))))).toEqual(row[7].split(',').map(Number));
    }
    const tree = noiseFallbacks['scene-08'].diagram!;
    const packet = value(encodeHuffman([65, 66, 67, 68]));
    expect(packet.merges).toEqual([{ left: 0, right: 1, parent: 4 }, { left: 2, right: 3, parent: 5 }, { left: 4, right: 5, parent: 6 }]);
    expect(tree.lines.map(line => line.label.en)).toEqual(['0: AB', '1: CD', '0: A', '1: B', '0: C', '1: D']);
    expect(tree.labels.slice(-4).map(label => label.text.en)).toEqual(packet.codes.map(code => code.code));
    expect(tree.lines.slice(2).map(line => line.points[0])).toEqual([[115, 100], [115, 100], [315, 100], [315, 100]]);
  });

  it('shows majority success and failure and SECDED zero/single/double-error decisions', () => {
    const majority = [value(decodeRepeat3([1, 0, 0]))[0], value(decodeRepeat3([1, 1, 0]))[0]];
    expect(rows('scene-09').slice(1).map(row => Number(row[4]))).toEqual(majority);
    for (const [index, flips] of [[], [0], [0, 1]].entries()) {
      const result = value(inspectSecded([1, 0, 1, 1], flips));
      const row = rows('scene-10')[index];
      expect(result.sent.join('')).toBe(row[1]);
      expect(result.received.join('')).toBe(row[3]);
      expect([result.decoded.syndrome, result.decoded.overall]).toEqual(row.slice(4, 6).map(Number));
      expect(result.decoded.decision).toBe(['no-alarm', 'corrected', 'rejected'][index]);
      if (result.decoded.data) expect(result.decoded.data.join('')).toBe(row[7]);
      else expect(row[7]).toBe('Not accepted');
    }
  });

  it('matches the three rates, whole-message budgets and explicitly static p=0 outcomes', () => {
    for (const [index, code] of (['raw', 'repeat3', 'secded'] as const).entries()) {
      const row = rows('scene-11')[index];
      const requirement = channelRequirement(512, code);
      const rate = row[3].split('/').map(Number);
      expect([Number(row[1]), Number(row[2]), rate[0] / (rate[1] ?? 1), Number(row[6])]).toEqual([requirement.k, requirement.n, requirement.rate, requirement.required]);
      expect(Number(row[5])).toBe(requirement.required - 512);
      expect(Number(row[8])).toBe(Math.floor(Number(row[7]) / requirement.n) * requirement.k);
      expect(Number(row[9])).toBe(Math.max(0, requirement.required - Number(row[7])));
      const run = runTransmission(Array.from({ length: 64 }, () => 65), { code, p: 0, seed: 20260905, budget: 1024 });
      if (code === 'repeat3') expect(run).toEqual({ ok: false, error: 'budget-exceeded' });
      else expect(value(run).outcome).toBe('exact');
    }
  });

  it('keeps scene twelve a fixed fictional example with identical copies in three contexts', () => {
    const lab = noiseLabs['scene-12'];
    if (lab.kind !== 'message-meaning') throw new Error('Wrong lab');
    for (const lang of ['vi', 'en'] as const) {
      const table = rows('scene-12', lang);
      expect(table.map(row => row[0])).toEqual(lab.config.contexts.map(context => context.label[lang]));
      expect(new Set(table.map(row => row[1])).size).toBe(1);
      for (const row of table) expect(new TextEncoder().encode(row[1])).toEqual(new TextEncoder().encode(row[2]));
    }
    expect(Object.entries(noiseFallbacks).filter(([, fallback]) => fallback.diagram).map(([id]) => id)).toEqual(['scene-02', 'scene-03', 'scene-04', 'scene-05', 'scene-08']);
  });
});
