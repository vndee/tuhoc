import { describe, expect, it } from 'vitest';
import { projectMemory } from './model';

describe('projectMemory', () => {
  it('projects retained marks using the illustrative generational model', () => {
    expect(projectMemory(0, 12, 0.8)).toBe(12);
    expect(projectMemory(3, 12, 0.8)).toBe(6);
    expect(projectMemory(8, 12, 1)).toBe(12);
  });

  it('clamps inputs to non-negative integers', () => {
    expect(projectMemory(-2.8, -12, -0.5)).toBe(0);
  });
});
