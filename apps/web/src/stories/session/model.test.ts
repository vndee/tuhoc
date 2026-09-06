import { describe, expect, it, vi } from 'vitest';
import type { DeliveryReceipt } from '../labs/communication/types';
import { createSession, reduceSession } from './model';

function makeReceipt(messageRevision = 0): DeliveryReceipt {
  return {
    messageRevision,
    messageText: 'Xin chào',
    source: [88, 105, 110],
    received: [88, 105, 110],
    config: { p: 0.05, seed: 20260905, code: 'raw', budget: 4096 },
    required: 24,
    outcome: 'exact',
    flippedBits: 0,
    payloadErrors: 0,
  };
}

describe('message session model', () => {
  it.each(['draft', 'shorten', 'commit'] as const)('rejects an oversized %s before segmentation and preserves the entire session', (type) => {
    const initial = { ...createSession('Original'), deliveryReceipt: makeReceipt() };
    const segmentation = vi.spyOn(Intl.Segmenter.prototype, 'segment');
    try {
      const result = reduceSession(initial, { type, text: 'x'.repeat(4097) });
      expect(result).toBe(initial);
      expect(segmentation).not.toHaveBeenCalled();
    } finally {
      segmentation.mockRestore();
    }
  });

  it.each(['draft', 'shorten'] as const)('retains a %s at the raw safety boundary without truncation', (type) => {
    const text = 'x'.repeat(4096);
    const result = reduceSession(createSession('Original'), { type, text });
    expect(result[type === 'draft' ? 'draftText' : 'shortenedDraft']).toBe(text);
    expect(result.messageText).toBe('Original');
  });

  it('creates a private journey from the exact example text', () => {
    expect(createSession('  Xin chào  ')).toEqual({
      messageText: '  Xin chào  ',
      messageRevision: 0,
      draftText: '  Xin chào  ',
      shortenedDraft: '  Xin chào  ',
      experimentStateByScene: {},
      deliveryReceipt: null,
    });
  });

  it('retains an invalid draft without changing the committed message', () => {
    const initial = createSession('Xin chào');
    const draft = reduceSession(initial, { type: 'draft', text: '   ' });

    expect(reduceSession(draft, { type: 'commit', text: draft.draftText })).toBe(draft);
    expect(draft.draftText).toBe('   ');
    expect(draft.messageText).toBe('Xin chào');
  });

  it('commits changed valid text exactly and advances only its revision', () => {
    const initial = reduceSession(createSession('Xin chào'), {
      type: 'lab', sceneId: 'scene-06', value: { seed: 7 },
    });
    const withReceipt = reduceSession(initial, { type: 'receipt', receipt: makeReceipt() });
    const next = reduceSession(withReceipt, { type: 'commit', text: '  Câu mới  ' });

    expect(next.messageText).toBe('  Câu mới  ');
    expect(next.draftText).toBe('  Câu mới  ');
    expect(next.messageRevision).toBe(withReceipt.messageRevision + 1);
    expect(next.experimentStateByScene).toBe(withReceipt.experimentStateByScene);
    expect(next.deliveryReceipt).toBe(withReceipt.deliveryReceipt);
    expect(withReceipt.messageText).toBe('Xin chào');
    expect(reduceSession(next, { type: 'commit', text: next.messageText })).toBe(next);
  });

  it('stores an immutable receipt snapshot and ignores stale asynchronous receipts', () => {
    const callerReceipt = makeReceipt();
    const stored = reduceSession(createSession('Xin chào'), { type: 'receipt', receipt: callerReceipt });
    (callerReceipt.source as number[])[0] = 0;
    (callerReceipt.received as number[])[0] = 0;
    callerReceipt.config.p = 0.5;

    expect(stored.deliveryReceipt).not.toBe(callerReceipt);
    expect(stored.deliveryReceipt?.source).toEqual([88, 105, 110]);
    expect(stored.deliveryReceipt?.received).toEqual([88, 105, 110]);
    expect(stored.deliveryReceipt?.config.p).toBe(0.05);
    expect(Object.isFrozen(stored.deliveryReceipt)).toBe(true);
    expect(Object.isFrozen(stored.deliveryReceipt?.source)).toBe(true);
    expect(Object.isFrozen(stored.deliveryReceipt?.received)).toBe(true);
    expect(Object.isFrozen(stored.deliveryReceipt?.config)).toBe(true);

    const revised = reduceSession(stored, { type: 'commit', text: 'Câu mới' });
    expect(reduceSession(revised, { type: 'receipt', receipt: makeReceipt(0) })).toBe(revised);
    expect(reduceSession(revised, { type: 'receipt', receipt: null }).deliveryReceipt).toBeNull();
  });

  it('applies the three lab reset contracts without replacing the message', () => {
    const receipt = makeReceipt();
    const populated = {
      ...createSession('Câu mới'),
      shortenedDraft: 'Câu',
      experimentStateByScene: {
        'scene-01': { budget: 15 },
        'scene-11': { batch: 'complete' },
        'scene-12': { context: 'c2' },
      },
      deliveryReceipt: receipt,
    };

    const scene01 = reduceSession(populated, { type: 'reset-lab', sceneId: 'scene-01' });
    expect(scene01.shortenedDraft).toBe('');
    expect(scene01.experimentStateByScene).not.toHaveProperty('scene-01');
    expect(scene01.experimentStateByScene).toHaveProperty('scene-11');
    expect(scene01.deliveryReceipt).toBe(receipt);
    expect(scene01.messageText).toBe('Câu mới');

    const scene11 = reduceSession(populated, { type: 'reset-lab', sceneId: 'scene-11' });
    expect(scene11.experimentStateByScene).not.toHaveProperty('scene-11');
    expect(scene11.experimentStateByScene).toHaveProperty('scene-12');
    expect(scene11.deliveryReceipt).toBeNull();
    expect(scene11.shortenedDraft).toBe('Câu');

    const scene12 = reduceSession(populated, { type: 'reset-lab', sceneId: 'scene-12' });
    expect(scene12.experimentStateByScene).not.toHaveProperty('scene-12');
    expect(scene12.experimentStateByScene).toHaveProperty('scene-11');
    expect(scene12.deliveryReceipt).toBe(receipt);
    expect(scene12.shortenedDraft).toBe('Câu');
  });

  it('starts a wholly fresh session only when explicitly dispatched', () => {
    const changed = reduceSession(createSession('Xin chào'), {
      type: 'lab', sceneId: 'scene-02', value: { code: '01' },
    });

    expect(reduceSession(changed, { type: 'reset-session', example: 'Hello' }))
      .toEqual(createSession('Hello'));
  });
});
