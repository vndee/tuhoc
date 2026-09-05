import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { LabFrame } from './LabFrame';

describe('LabFrame', () => {
  it('provides the lab instruction, atomic polite result, and localized controls', () => {
    const onReset = vi.fn();
    const onBack = vi.fn();
    render(<LabFrame lang="vi" title="Bàn tính" instruction="Thử tính ba cộng bốn." result="Kết quả: 7" onReset={onReset} onBack={onBack}><p>7</p></LabFrame>);

    const section = screen.getByRole('region', { name: 'Bàn tính' });
    expect(section).toHaveAttribute('aria-labelledby');
    expect(screen.getByText('Thử tính ba cộng bốn.')).toBeVisible();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Kết quả: 7');
    expect(screen.getByRole('button', { name: 'Đặt lại' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Trở lại tranh' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Đặt lại' }));
    fireEvent.click(screen.getByRole('button', { name: 'Trở lại tranh' }));
    expect(onReset).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('uses unique heading IDs and English catalog controls for separate frames', () => {
    render(<>
      <LabFrame lang="en" title="First lab" instruction="First instruction" result="First result" onReset={() => undefined} onBack={() => undefined}><p>First child</p></LabFrame>
      <LabFrame lang="en" title="Second lab" instruction="Second instruction" result="Second result" onReset={() => undefined} onBack={() => undefined}><p>Second child</p></LabFrame>
    </>);

    const first = screen.getByRole('region', { name: 'First lab' });
    const second = screen.getByRole('region', { name: 'Second lab' });
    expect(first.getAttribute('aria-labelledby')).not.toBe(second.getAttribute('aria-labelledby'));
    expect(screen.getAllByRole('button', { name: 'Reset' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Back to illustration' })).toHaveLength(2);
  });

  it('declares 44px controls and keyboard-visible focus styling', () => {
    const css = readFileSync(resolve(__dirname, '../../styles/stories.css'), 'utf-8');
    expect(css).toMatch(/\.story-lab-frame-controls button\s*\{[\s\S]*?min-height:\s*var\(--story-target-size, 44px\)/);
    expect(css).toMatch(/\.story-lab-frame-controls button\s*\{[\s\S]*?min-width:\s*var\(--story-target-size, 44px\)/);
    expect(css).toMatch(/\.story-shell button:focus-visible/);
  });
});
