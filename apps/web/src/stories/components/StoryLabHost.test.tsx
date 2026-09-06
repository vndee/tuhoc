import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeStoryFixture } from '../testing/storyFixture';
import { labRegistry } from '../labs/registry';
import type { LabModule, LabRuntimeProps } from '../labs/runtime';
import { StoryLabHost } from './StoryLabHost';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const scene = makeStoryFixture().scenes[0]!;

afterEach(() => vi.restoreAllMocks());

describe('StoryLabHost', () => {
  it('keeps the static bilingual fallback readable while the selected lab loads', async () => {
    const module = deferred<LabModule>();
    vi.spyOn(labRegistry, 'embodied-calculation').mockReturnValue(module.promise);
    render(<StoryLabHost scene={{ ...scene, lab: { ...scene.lab, kind: 'embodied-calculation' } as typeof scene.lab }} lang="en" value={undefined} onChange={vi.fn()} onReset={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByText('External memory')).toBeVisible();
    expect(screen.getByRole('region', { name: 'External memory' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Compare the generations.')).toBeVisible();
    expect(screen.getByText('Retention diagram')).toBeVisible();
    expect(screen.getByText('Symbols preserve more information.')).toBeVisible();

    await act(async () => module.resolve({ default: () => <p>Loaded lab</p> }));
    expect(screen.getByText('Loaded lab')).toBeVisible();
  });

  it('contains a selected lab loader rejection in the local boundary', async () => {
    const module = deferred<LabModule>();
    vi.spyOn(labRegistry, 'agent-trace').mockReturnValue(module.promise);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<StoryLabHost scene={{ ...scene, id: 'scene-error', lab: { ...scene.lab, kind: 'agent-trace' } as typeof scene.lab }} lang="en" value={undefined} onChange={vi.fn()} onReset={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByRole('region', { name: 'External memory' })).toHaveAttribute('aria-busy', 'true');
    await act(async () => module.reject(new Error('chunk unavailable')));
    expect(screen.getByRole('region', { name: 'External memory' })).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(screen.getByText('Symbols preserve more information.')).toBeVisible();
  });

  it('retries a one-time failed importer in place and does not duplicate fallback content', async () => {
    const first = deferred<LabModule>();
    const loader = vi.spyOn(labRegistry, 'external-memory')
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ default: () => <p>Recovered after retry</p> });
    const back = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retryScene = {
      ...scene,
      labFallback: {
        ...scene.labFallback,
        table: {
          vi: { headers: ['Gửi', 'Nhận'], rows: [['00', '01']] },
          en: { headers: ['Sent', 'Received'], rows: [['00', '01']] },
        },
      },
    };
    render(<StoryLabHost scene={retryScene} lang="en" value={undefined} onChange={vi.fn()} onReset={vi.fn()} onBack={back} />);

    await act(async () => first.reject(new Error('temporary chunk outage')));
    expect(screen.getByRole('table', { name: 'Retention diagram' })).toBeVisible();
    expect(screen.getAllByText('Retention diagram')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Back to illustration' }));
    expect(back).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await act(async () => { await Promise.resolve(); });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Recovered after retry')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('lets a second host retry a rejected chunk for the same scene and kind', async () => {
    const first = deferred<LabModule>();
    const second = deferred<LabModule>();
    const loader = vi.spyOn(labRegistry, 'external-memory')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const props = { scene, lang: 'en' as const, value: undefined, onChange: vi.fn(), onReset: vi.fn(), onBack: vi.fn() };
    const firstHost = render(<StoryLabHost {...props} />);

    await act(async () => first.reject(new Error('temporary chunk outage')));
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    firstHost.unmount();

    render(<StoryLabHost {...props} />);
    expect(loader).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve({ default: () => <p>Retried lab</p> }));
    expect(screen.getByText('Retried lab')).toBeVisible();
  });

  it('provides fresh initial state and remounts it after reset', async () => {
    const FakeLab = ({ value, onChange, onReset }: LabRuntimeProps) => <>
      <output>{JSON.stringify(value)}</output>
      <button type="button" onClick={() => onChange({ generation: 2 })}>Change</button>
      <button type="button" onClick={onReset}>Reset</button>
    </>;
    vi.spyOn(labRegistry, 'judgment-criteria').mockResolvedValue({ default: FakeLab });
    let value: unknown;
    const Host = () => <StoryLabHost scene={{ ...scene, id: 'scene-state', lab: { ...scene.lab, kind: 'judgment-criteria' } as typeof scene.lab }} lang="en" value={value} onChange={(next) => { value = next; }} onReset={() => { value = undefined; }} onBack={vi.fn()} />;
    const view = render(<Host />);

    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('{"enabledIds":[]}')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    view.rerender(<Host />);
    expect(screen.getByText('{"generation":2}')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    view.rerender(<Host />);
    expect(screen.getByText('{"enabledIds":[]}')).toBeVisible();
  });

  it('ignores a stale loader resolution after the reader selects another kind', async () => {
    const external = deferred<LabModule>();
    const computation = deferred<LabModule>();
    vi.spyOn(labRegistry, 'external-memory').mockReturnValue(external.promise);
    vi.spyOn(labRegistry, 'computation-limits').mockReturnValue(computation.promise);
    const view = render(<StoryLabHost scene={scene} lang="en" value={undefined} onChange={vi.fn()} onReset={vi.fn()} onBack={vi.fn()} />);
    const nextScene = {
      ...scene,
      id: 'scene-next' as typeof scene.id,
      lab: { ...scene.lab, kind: 'computation-limits' } as typeof scene.lab,
    };
    view.rerender(<StoryLabHost scene={nextScene} lang="en" value={undefined} onChange={vi.fn()} onReset={vi.fn()} onBack={vi.fn()} />);

    await act(async () => computation.resolve({ default: () => <p>Current computation lab</p> }));
    await act(async () => external.resolve({ default: () => <p>Stale external lab</p> }));
    expect(screen.getByText('Current computation lab')).toBeVisible();
    expect(screen.queryByText('Stale external lab')).not.toBeInTheDocument();
  });
});
