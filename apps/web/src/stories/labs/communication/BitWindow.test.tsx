import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Bits } from './types';
import { BitWindow } from './BitWindow';

describe('BitWindow', () => {
  it('bounds an 8,192-bit payload to one 64-bit page with its full range', () => {
    const bits = Array<0 | 1>(8_192).fill(0);
    render(<BitWindow bits={bits} lang="en" page={0} onPage={() => undefined} flipped={[]} />);

    expect(screen.getAllByRole('button', { name: /Bit \d+:/ })).toHaveLength(64);
    expect(screen.getByText('Bits 1–64 of 8,192')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Previous bits' })).toBeDisabled();
  });

  it('uses absolute bit indices after paging and reports the selected absolute index', () => {
    const onPage = vi.fn();
    const onFlip = vi.fn();
    const bits = Array<0 | 1>(130).fill(0) as Bits;
    const view = render(<BitWindow bits={bits} lang="en" page={0} onPage={onPage} flipped={[]} onFlip={onFlip} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next bits' }));
    expect(onPage).toHaveBeenCalledWith(1);

    view.rerender(<BitWindow bits={bits} lang="en" page={1} onPage={onPage} flipped={[64]} onFlip={onFlip} />);
    expect(screen.getByText('Bits 65–128 of 130')).toBeVisible();
    const first = screen.getByRole('button', { name: 'Bit 65: 0, flipped' });
    expect(first).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(first);
    expect(onFlip).toHaveBeenCalledWith(64);
  });

  it('safely clamps an out-of-range page without rendering an unbounded window', () => {
    render(<BitWindow bits={[0, 1, 0]} lang="vi" page={Number.MAX_SAFE_INTEGER} onPage={() => undefined} flipped={[]} />);

    expect(screen.getAllByRole('button', { name: /Bit \d+:/ })).toHaveLength(3);
    expect(screen.getByText('Bit 1–3 trên 3')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Bit tiếp theo' })).toBeDisabled();
  });
});
