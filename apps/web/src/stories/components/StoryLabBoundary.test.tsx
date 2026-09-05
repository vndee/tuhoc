import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LabFallback } from '../types';
import { StoryLabBoundary } from './StoryLabBoundary';

const fallback: LabFallback = {
  diagramLabel: { vi: 'Sơ đồ tĩnh', en: 'Static diagram' },
  explanation: { vi: 'Bạn vẫn có thể đọc lời giải thích này.', en: 'You can still read this explanation.' },
};

function BrokenLab(): never { throw new Error('broken'); }

let recoversOnRetry = false;
function ResettableLab() {
  if (!recoversOnRetry) throw new Error('until reset');
  return <p>Recovered lab</p>;
}

afterEach(() => vi.restoreAllMocks());

describe('StoryLabBoundary', () => {
  it('contains a lab render failure and preserves the localized static explanation', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<StoryLabBoundary fallback={fallback} lang="vi"><BrokenLab /></StoryLabBoundary>);

    expect(screen.getByText('Lab tương tác không tải được. Bạn vẫn có thể đọc phần giải thích dưới đây.')).toBeVisible();
    expect(screen.getByText(fallback.diagramLabel.vi)).toBeVisible();
    expect(screen.getByText(fallback.explanation.vi)).toBeVisible();
  });

  it('retries the same child shape when the scene reset key changes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    recoversOnRetry = false;
    const { rerender } = render(<StoryLabBoundary fallback={fallback} lang="en" resetKey="scene-1"><ResettableLab /></StoryLabBoundary>);
    expect(screen.getByText('The interactive lab could not load. You can still read its explanation below.')).toBeVisible();

    recoversOnRetry = true;
    rerender(<StoryLabBoundary fallback={fallback} lang="en" resetKey="scene-2"><ResettableLab /></StoryLabBoundary>);
    expect(screen.getByText('Recovered lab')).toBeVisible();
  });

  it('uses current language and fallback props while it remains failed', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const updatedFallback: LabFallback = {
      diagramLabel: { vi: 'Sơ đồ mới', en: 'Updated static diagram' },
      explanation: { vi: 'Lời giải thích mới.', en: 'Updated explanation.' },
    };
    const { rerender } = render(<StoryLabBoundary fallback={fallback} lang="vi" resetKey="scene-1"><BrokenLab /></StoryLabBoundary>);
    expect(screen.getByText(fallback.explanation.vi)).toBeVisible();

    rerender(<StoryLabBoundary fallback={updatedFallback} lang="en" resetKey="scene-1"><BrokenLab /></StoryLabBoundary>);
    expect(screen.getByText('The interactive lab could not load. You can still read its explanation below.')).toBeVisible();
    expect(screen.getByText(updatedFallback.diagramLabel.en)).toBeVisible();
    expect(screen.getByText(updatedFallback.explanation.en)).toBeVisible();
  });
});
