import { describe, expect, it } from 'vitest';
import { MAX_OBSERVED_TAPE_CELLS, runBoundedMachine, stepMachine, type MachineProgram, type MachineSnapshot } from './model';

const haltingProgram: MachineProgram = {
  scan: { write: '1', move: 1, next: 'halt' },
};

describe('machine model', () => {
  it('clones and advances one configured transition without mutating the input snapshot', () => {
    const snapshot: MachineSnapshot = { tape: ['1'], head: 0, state: 'scan', halted: false };

    expect(stepMachine(snapshot, haltingProgram)).toEqual({ tape: ['1', '1'], head: 1, state: 'halt', halted: true });
    expect(snapshot).toEqual({ tape: ['1'], head: 0, state: 'scan', halted: false });
  });

  it('grows a bounded blank tape safely when a transition moves left of its first cell', () => {
    const snapshot: MachineSnapshot = { tape: ['0'], head: 0, state: 'left', halted: false };

    expect(stepMachine(snapshot, { left: { write: '1', move: -1, next: 'done' } }))
      .toEqual({ tape: ['1', '0'], head: 0, state: 'done', halted: true });
  });

  it('preserves halted or missing-transition snapshots as fresh snapshots', () => {
    const halted: MachineSnapshot = { tape: ['x'], head: 0, state: 'halt', halted: true };
    const missing: MachineSnapshot = { tape: ['x'], head: 0, state: 'unknown', halted: false };

    const haltedNext = stepMachine(halted, haltingProgram);
    const missingNext = stepMachine(missing, haltingProgram);

    expect(haltedNext).toEqual(halted);
    expect(missingNext).toEqual({ ...missing, halted: true });
    expect(haltedNext.tape).not.toBe(halted.tape);
    expect(missingNext.tape).not.toBe(missing.tape);
  });

  it('reports a finite bounded run as halted instead of making a general halting claim', () => {
    expect(runBoundedMachine({ tape: ['0'], head: 0, state: 'scan', halted: false }, haltingProgram, 4))
      .toEqual({ status: 'halted', snapshot: { tape: ['0', '1'], head: 1, state: 'halt', halted: true }, steps: 1 });
  });

  it('reports a repeated bounded snapshot as a cycle', () => {
    const looping: MachineProgram = {
      left: { write: '', move: 1, next: 'right' },
      right: { write: '', move: -1, next: 'left' },
    };

    expect(runBoundedMachine({ tape: ['', ''], head: 0, state: 'left', halted: false }, looping, 20))
      .toMatchObject({ status: 'cycle-detected', steps: 2 });
  });

  it('reports an expanding run only as a step limit', () => {
    const expanding: MachineProgram = { loop: { write: '1', move: 1, next: 'loop' } };

    expect(runBoundedMachine({ tape: [''], head: 0, state: 'loop', halted: false }, expanding, 20))
      .toMatchObject({ status: 'step-limit', steps: 20 });
  });

  it('does not call a right-expanding run a cycle after it saturates the display window', () => {
    const expanding: MachineProgram = { loop: { write: '1', move: 1, next: 'loop' } };

    const result = runBoundedMachine({ tape: [''], head: 0, state: 'loop', halted: false }, expanding, 300);

    expect(result).toMatchObject({ status: 'step-limit', steps: 300 });
    expect(result.snapshot.tape).toHaveLength(MAX_OBSERVED_TAPE_CELLS);
    expect(result.snapshot.head).toBe(MAX_OBSERVED_TAPE_CELLS - 1);
  });

  it('does not call repeated moves past the left observation boundary a cycle', () => {
    const expandingLeft: MachineProgram = { loop: { write: '', move: -1, next: 'loop' } };

    const result = runBoundedMachine({ tape: [''], head: 0, state: 'loop', halted: false }, expandingLeft, 300);

    expect(result).toMatchObject({ status: 'step-limit', steps: 300 });
    expect(result.snapshot.tape).toHaveLength(MAX_OBSERVED_TAPE_CELLS);
    expect(result.snapshot.head).toBe(0);
  });

  it('uses an exact long current state for rule lookup before truncating its public display', () => {
    const displayPrefix = 's'.repeat(256);
    const exactState = `${displayPrefix}-exact`;
    const program: MachineProgram = {
      [displayPrefix]: { write: 'wrong', move: 1, next: 'missing' },
      [exactState]: { write: '1', move: 1, next: 'done' },
    };
    const snapshot: MachineSnapshot = { tape: [''], head: 0, state: exactState, halted: false };

    expect(stepMachine(snapshot, program)).toEqual({ tape: ['', '1'], head: 1, state: 'done', halted: true });
    expect(runBoundedMachine(snapshot, program, 3)).toEqual({
      status: 'halted',
      snapshot: { tape: ['', '1'], head: 1, state: 'done', halted: true },
      steps: 1,
    });
  });

  it('carries an exact long next-state identifier privately to its subsequent authored rule', () => {
    const longState = `next-${'x'.repeat(256)}`;
    const program: MachineProgram = {
      start: { write: 'a', move: 1, next: longState },
      [longState]: { write: 'b', move: 1, next: 'done' },
    };

    expect(runBoundedMachine({ tape: [''], head: 0, state: 'start', halted: false }, program, 3)).toEqual({
      status: 'halted',
      snapshot: { tape: ['', 'a', 'b'], head: 2, state: 'done', halted: true },
      steps: 2,
    });
  });

  it('preserves an exact long state across repeated public one-step calls', () => {
    const displayPrefix = 's'.repeat(256);
    const exactState = `${displayPrefix}-exact`;
    const program: MachineProgram = {
      start: { write: 'a', move: 1, next: exactState },
      [displayPrefix]: { write: 'wrong', move: 1, next: 'done' },
      [exactState]: { write: 'right', move: 1, next: 'done' },
    };

    const afterFirstStep = stepMachine({ tape: [''], head: 0, state: 'start', halted: false }, program);
    const afterSecondStep = stepMachine(afterFirstStep, program);

    expect(afterFirstStep.state).toBe(exactState);
    expect(afterSecondStep).toEqual({ tape: ['', 'a', 'right'], head: 2, state: 'done', halted: true });
  });

  it('retains an already-allocated huge external state without expanding the observation structure', () => {
    const hugeState = `${'huge-state-'.padEnd(999_990, 'x')}-exact-tail`;
    const snapshot: MachineSnapshot = { tape: [''], head: 0, state: hugeState, halted: true };

    const result = runBoundedMachine(snapshot, {}, 0);

    expect(result.status).toBe('halted');
    expect(result.snapshot.state).toHaveLength(hugeState.length);
    expect(result.snapshot.state.endsWith('-exact-tail')).toBe(true);
    expect(result.snapshot.tape).not.toBe(snapshot.tape);
  });

  it('normalizes an invalid step bound to a zero-step finite observation', () => {
    expect(runBoundedMachine({ tape: [''], head: 0, state: 'loop', halted: false }, { loop: { write: '1', move: 1, next: 'loop' } }, -3.5))
      .toMatchObject({ status: 'step-limit', steps: 0 });
  });

  it('normalizes negative, fractional, and non-finite heads without mutating the supplied snapshots', () => {
    const negative: MachineSnapshot = { tape: ['a', 'b'], head: -3.7, state: 'missing', halted: false };
    const fractional: MachineSnapshot = { tape: ['a', 'b'], head: 1.8, state: 'missing', halted: false };
    const nonFinite: MachineSnapshot = { tape: ['a', 'b'], head: Infinity, state: 'missing', halted: false };
    const source = structuredClone([negative, fractional, nonFinite]);

    expect(runBoundedMachine(negative, {}, 0).snapshot.head).toBe(0);
    expect(runBoundedMachine(fractional, {}, 0).snapshot.head).toBe(1);
    expect(runBoundedMachine(nonFinite, {}, 0).snapshot.head).toBe(0);
    expect([negative, fractional, nonFinite]).toEqual(source);
  });

  it('bounds oversized external tape and head before a zero-step observation allocates or hashes them', () => {
    const snapshot: MachineSnapshot = {
      tape: Array.from({ length: MAX_OBSERVED_TAPE_CELLS + 25 }, (_, index) => `cell-${index}`),
      head: 1_000_000_000,
      state: 'loop',
      halted: false,
    };
    const source = structuredClone(snapshot);

    const result = runBoundedMachine(snapshot, { loop: { write: '1', move: 1, next: 'loop' } }, 0);

    expect(result).toMatchObject({ status: 'step-limit', steps: 0 });
    expect(result.snapshot.tape).toHaveLength(MAX_OBSERVED_TAPE_CELLS);
    expect(result.snapshot.head).toBe(MAX_OBSERVED_TAPE_CELLS - 1);
    expect(snapshot).toEqual(source);
  });

  it('keeps distinct bounded tapes distinct even when a delimiter join would collide', () => {
    const program: MachineProgram = {
      go: { write: 'a', move: -1, next: 'return' },
      return: { write: 'b|c', move: 1, next: 'go' },
    };
    const snapshot: MachineSnapshot = { tape: ['a|b', 'c'], head: 1, state: 'go', halted: false };

    expect(runBoundedMachine(snapshot, program, 2)).toEqual({
      status: 'step-limit',
      snapshot: { tape: ['a', 'b|c'], head: 1, state: 'go', halted: false },
      steps: 2,
    });
  });
});
