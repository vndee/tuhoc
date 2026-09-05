export interface MachineSnapshot {
  tape: string[];
  head: number;
  state: string;
  halted: boolean;
}

export interface MachineTransition {
  write: string;
  move: -1 | 1;
  next: string;
}

export type MachineProgram = Record<string, MachineTransition>;

export type BoundedRunStatus = 'halted' | 'cycle-detected' | 'step-limit';

const MAX_OBSERVATION_STEPS = 10_000;
/**
 * The finite snapshot window accepted by this illustrative machine. Incoming
 * tape beyond this window is not observed, positions beyond it are pinned to
 * the final observable cell, and cells are truncated to finite display strings
 * before a snapshot is copied or recorded. State remains exact for execution.
 */
export const MAX_OBSERVED_TAPE_CELLS = 256;
const MAX_OBSERVED_CELL_CHARS = 256;
const MAX_OBSERVED_STATE_CHARS = 256;

/** Advances one visible, finite machine transition. It does not schedule execution. */
export function stepMachine(snapshot: MachineSnapshot, program: MachineProgram): MachineSnapshot {
  return stepObservedMachine(snapshot, program).snapshot;
}

function stepObservedMachine(snapshot: MachineSnapshot, program: MachineProgram): ObservedStep {
  const normalized = normalizeSnapshot(snapshot);
  const current = normalized.snapshot;
  let saturated = normalized.saturated;
  if (current.halted) return { snapshot: current, saturated };

  const transition = program[current.state];
  if (!transition) return { snapshot: { ...current, halted: true }, saturated };

  const move = transition.move === -1 ? -1 : 1;
  let nextHead = current.head + move;
  if (nextHead < 0) {
    saturated = true;
    current.tape.unshift('');
    if (current.tape.length > MAX_OBSERVED_TAPE_CELLS) current.tape.pop();
    nextHead = 0;
  }
  if (nextHead >= MAX_OBSERVED_TAPE_CELLS) saturated = true;
  nextHead = Math.min(MAX_OBSERVED_TAPE_CELLS - 1, nextHead);
  while (nextHead >= current.tape.length) current.tape.push('');

  if (typeof transition.write !== 'string' || transition.write.length > MAX_OBSERVED_CELL_CHARS) saturated = true;
  if (typeof transition.next !== 'string' || transition.next.length > MAX_OBSERVED_STATE_CHARS) saturated = true;
  current.tape[nextHead] = normalizeCell(transition.write);
  const nextState = typeof transition.next === 'string' ? transition.next : current.state;
  return {
    snapshot: {
      tape: [...current.tape],
      head: nextHead,
      state: nextState,
      halted: !program[nextState],
    },
    saturated,
  };
}

/**
 * Observes only this finite run. A result is never a decision about arbitrary
 * programs: it can only halt, repeat an exactly represented finite snapshot,
 * or reach the supplied observation bound. Cycle reporting stops once the
 * finite observation window has discarded an input or transition distinction.
 * Public snapshots retain the exact state key used for program lookup.
 */
export function runBoundedMachine(
  snapshot: MachineSnapshot,
  program: MachineProgram,
  maxSteps: number,
): { status: BoundedRunStatus; snapshot: MachineSnapshot; steps: number } {
  const initial = normalizeSnapshot(snapshot);
  let current = initial.snapshot;
  const limit = normalizeStepLimit(maxSteps);
  const seen = new ObservedSnapshotSet();
  let mayDetectCycle = !initial.saturated;
  if (mayDetectCycle) seen.add(current);
  let steps = 0;

  if (current.halted || !program[current.state]) {
    if (!current.halted) current = { ...current, halted: true };
    return { status: 'halted', snapshot: current, steps };
  }

  while (steps < limit) {
    const observedStep = stepObservedMachine(current, program);
    current = observedStep.snapshot;
    steps += 1;
    if (current.halted) return { status: 'halted', snapshot: current, steps };

    if (observedStep.saturated) mayDetectCycle = false;
    if (mayDetectCycle) {
      if (seen.has(current)) return { status: 'cycle-detected', snapshot: current, steps };
      seen.add(current);
    }
  }

  return { status: 'step-limit', snapshot: current, steps };
}

function normalizeSnapshot(snapshot: MachineSnapshot): NormalizedSnapshot {
  const sourceTape = Array.isArray(snapshot?.tape) ? snapshot.tape : [];
  const tape = sourceTape.slice(0, MAX_OBSERVED_TAPE_CELLS).map(normalizeCell);
  if (tape.length === 0) tape.push('');
  const inputHead = snapshot?.head;
  const rawHead = typeof inputHead === 'number' && Number.isFinite(inputHead) ? Math.trunc(inputHead) : 0;
  const head = Math.min(MAX_OBSERVED_TAPE_CELLS - 1, Math.max(0, rawHead));
  while (head >= tape.length) tape.push('');

  const inputState = snapshot?.state;
  const saturated = sourceTape.length > MAX_OBSERVED_TAPE_CELLS
    || sourceTape.slice(0, MAX_OBSERVED_TAPE_CELLS).some((cell) => typeof cell !== 'string' || cell.length > MAX_OBSERVED_CELL_CHARS)
    || typeof inputHead !== 'number' || !Number.isFinite(inputHead) || !Number.isInteger(inputHead)
    || inputHead < 0 || inputHead >= MAX_OBSERVED_TAPE_CELLS
    || typeof inputState !== 'string' || inputState.length > MAX_OBSERVED_STATE_CHARS;

  return {
    snapshot: {
      tape,
      head,
      state: typeof inputState === 'string' ? inputState : '',
      halted: snapshot?.halted === true,
    },
    saturated,
  };
}

interface NormalizedSnapshot {
  snapshot: MachineSnapshot;
  /** True once original machine state no longer has a one-to-one bounded observation. */
  saturated: boolean;
}

interface ObservedStep extends NormalizedSnapshot {}

function normalizeCell(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_OBSERVED_CELL_CHARS) : '';
}

/** A structural trie preserves exact identity without serializing or joining cell values. */
class ObservedSnapshotSet {
  private readonly root: ObservedTapeNode = { children: new Map(), terminal: new Map() };

  has(snapshot: MachineSnapshot): boolean {
    let node = this.root;
    for (const cell of snapshot.tape) {
      let child = node.children.get(cell);
      if (!child) {
        child = { children: new Map(), terminal: new Map() };
        node.children.set(cell, child);
      }
      node = child;
    }
    return node.terminal.get(snapshot.head)?.has(observedState(snapshot.state)) ?? false;
  }

  add(snapshot: MachineSnapshot): void {
    let node = this.root;
    for (const cell of snapshot.tape) {
      let child = node.children.get(cell);
      if (!child) {
        child = { children: new Map(), terminal: new Map() };
        node.children.set(cell, child);
      }
      node = child;
    }
    const states = node.terminal.get(snapshot.head) ?? new Set<string>();
    states.add(observedState(snapshot.state));
    node.terminal.set(snapshot.head, states);
  }
}

function observedState(state: string): string {
  return state.slice(0, MAX_OBSERVED_STATE_CHARS);
}

interface ObservedTapeNode {
  children: Map<string, ObservedTapeNode>;
  terminal: Map<number, Set<string>>;
}

function normalizeStepLimit(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(MAX_OBSERVATION_STEPS, Math.trunc(value));
}
