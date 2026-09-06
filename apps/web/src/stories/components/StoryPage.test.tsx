import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeLocalStorage } from '../../db/localStorage';
import { LANG_STORAGE_KEY } from '../../i18n';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { ThemeProvider } from '../../theme/ThemeContext';
import type { StoryDefinition, StoryRegistryEntry } from '../types';

const registry = vi.hoisted(() => ({
  entries: [] as StoryRegistryEntry[],
  commits: [] as Array<{ path: string; status: string | null; heading: string | null; renderedStory: string | null }>,
}));

vi.mock('../content/registry', () => ({
  resolveStoryEntry: (slug: string, allowDrafts: boolean) => registry.entries.find(
    (entry) => entry.slug === slug && (entry.published || allowDrafts),
  ),
}));

vi.mock('./StoryRenderer', () => ({
  StoryRenderer: ({ story }: { story: StoryDefinition }) => <p>Rendered {story.meta.slug}</p>,
}));

import StoryPage from './StoryPage';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function story(slug: string): StoryDefinition {
  return { meta: { slug, title: { vi: slug, en: slug }, deck: { vi: slug, en: slug } } } as StoryDefinition;
}

function entry(slug: string, load: StoryRegistryEntry['load'], published = true): StoryRegistryEntry {
  return {
    slug,
    issueNumber: 1,
    published,
    featured: false,
    title: { vi: slug, en: slug },
    deck: { vi: slug, en: slug },
    cover: {
      src: `/${slug}.webp`, srcSet: `/${slug}.webp 1200w`, sizes: '100vw', width: 1200, height: 800, bytes: 1,
      alt: { vi: slug, en: slug }, caption: { vi: slug, en: slug }, provenanceId: slug,
    },
    sceneCount: 0,
    labCount: 0,
    load,
  };
}

function renderPage(initialEntry: string) {
  return render(
    <ThemeProvider><LanguageProvider><MemoryRouter initialEntries={[initialEntry]}>
      <Routes><Route path="/stories/:slug" element={<StoryPage />} /></Routes>
    </MemoryRouter></LanguageProvider></ThemeProvider>,
  );
}

function StoryRouteControls() {
  const navigate = useNavigate();
  return <>
    <button type="button" onClick={() => navigate('/stories/second')}>Open second</button>
    <button type="button" onClick={() => navigate('/stories/missing')}>Open missing</button>
    <button type="button" onClick={() => navigate('/stories/draft')}>Drop draft preview</button>
  </>;
}

function RouteCommitSnapshot() {
  const location = useLocation();
  useLayoutEffect(() => {
    registry.commits.push({
      path: location.pathname,
      status: document.querySelector('[role="status"]')?.textContent ?? null,
      heading: document.querySelector('h1')?.textContent ?? null,
      renderedStory: document.querySelector('p')?.textContent ?? null,
    });
  }, [location.pathname]);
  return null;
}

afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
  document.head.querySelectorAll('meta[name="robots"]').forEach((node) => node.remove());
});

describe('StoryPage', () => {
  it('renders a published story after its module loads', async () => {
    const load = deferred<{ default: StoryDefinition }>();
    registry.entries = [entry('published', vi.fn(() => load.promise))];

    renderPage('/stories/published');

    expect(screen.getByRole('status')).toHaveTextContent('Đang mở đặc san…');
    expect(screen.getByRole('status').closest('.story-shell')).toBeInTheDocument();
    load.resolve({ default: story('published') });
    expect(await screen.findByText('Rendered published')).toBeInTheDocument();
  });

  it.each([
    ['missing', [] as StoryRegistryEntry[]],
    ['draft', [entry('draft', vi.fn(), false)]],
  ])('explains when %s is unknown or unpublished', async (slug, entries) => {
    registry.entries = entries;

    renderPage(`/stories/${slug}`);

    expect(await screen.findByRole('heading', { name: 'Không tìm thấy số đặc san' })).toBeInTheDocument();
    expect(screen.getByText('Số này không tồn tại hoặc chưa được phát hành.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Trở lại các số đặc san' })).toHaveAttribute('href', '/stories');
  });

  it('shows an in-shell failure and retries a rejected module load', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ default: story('broken') });
    registry.entries = [entry('broken', load)];

    renderPage('/stories/broken');

    expect(await screen.findByText('Không thể mở số đặc san này.')).toBeInTheDocument();
    screen.getByRole('button', { name: 'Thử lại' }).click();

    expect(await screen.findByText('Rendered broken')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not let an old slug loader overwrite the newer route', async () => {
    const first = deferred<{ default: StoryDefinition }>();
    const second = deferred<{ default: StoryDefinition }>();
    registry.entries = [
      entry('first', vi.fn(() => first.promise)),
      entry('second', vi.fn(() => second.promise)),
    ];
    // Mount the real route at the first slug, then change only its parameter.
    // The original promise remains pending while the next route starts loading.
    render(
      <ThemeProvider><LanguageProvider><MemoryRouter initialEntries={['/stories/first']}>
        <Routes><Route path="/stories/:slug" element={<><StoryPage /><StoryRouteControls /><RouteCommitSnapshot /></>} /></Routes>
      </MemoryRouter></LanguageProvider></ThemeProvider>,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Open second' }).at(-1)!);
    second.resolve({ default: story('second') });

    expect(await screen.findByText('Rendered second')).toBeInTheDocument();
    first.reject(new Error('obsolete request failed'));
    await waitFor(() => expect(screen.queryByText('Rendered first')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('never renders a ready story from the old slug while the next slug loads', async () => {
    const first = deferred<{ default: StoryDefinition }>();
    const second = deferred<{ default: StoryDefinition }>();
    registry.entries = [
      entry('first', vi.fn(() => first.promise)),
      entry('second', vi.fn(() => second.promise)),
    ];
    render(
      <ThemeProvider><LanguageProvider><MemoryRouter initialEntries={['/stories/first']}>
        <Routes><Route path="/stories/:slug" element={<><StoryPage /><StoryRouteControls /><RouteCommitSnapshot /></>} /></Routes>
      </MemoryRouter></LanguageProvider></ThemeProvider>,
    );
    first.resolve({ default: story('first') });
    expect(await screen.findByText('Rendered first')).toBeInTheDocument();
    registry.commits.splice(0);

    fireEvent.click(screen.getByRole('button', { name: 'Open second' }));

    await waitFor(() => expect(registry.commits).toContainEqual({
      path: '/stories/second', status: 'Đang mở đặc san…', heading: null, renderedStory: 'Đang mở đặc san…',
    }));
    second.resolve({ default: story('second') });
    expect(await screen.findByText('Rendered second')).toBeInTheDocument();
  });

  it('never renders a ready story from the old slug before an unknown slug is not found', async () => {
    const first = deferred<{ default: StoryDefinition }>();
    registry.entries = [entry('first', vi.fn(() => first.promise))];
    render(
      <ThemeProvider><LanguageProvider><MemoryRouter initialEntries={['/stories/first']}>
        <Routes><Route path="/stories/:slug" element={<><StoryPage /><StoryRouteControls /><RouteCommitSnapshot /></>} /></Routes>
      </MemoryRouter></LanguageProvider></ThemeProvider>,
    );
    first.resolve({ default: story('first') });
    expect(await screen.findByText('Rendered first')).toBeInTheDocument();
    registry.commits.splice(0);

    fireEvent.click(screen.getByRole('button', { name: 'Open missing' }));

    await waitFor(() => expect(registry.commits).toContainEqual({
      path: '/stories/missing', status: null, heading: 'Không tìm thấy số đặc san', renderedStory: 'Số này không tồn tại hoặc chưa được phát hành.',
    }));
    expect(await screen.findByRole('heading', { name: 'Không tìm thấy số đặc san' })).toBeInTheDocument();
  });

  it('does not leak a pending loader rejection after unmount', async () => {
    const pending = deferred<{ default: StoryDefinition }>();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    registry.entries = [entry('pending', vi.fn(() => pending.promise))];
    const view = renderPage('/stories/pending');

    view.unmount();
    pending.reject(new Error('unmounted request failed'));
    await Promise.resolve();

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('ignores a preview query in production mode and never invokes the draft loader', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('MODE', 'production');
    const load = vi.fn();
    registry.entries = [entry('draft', load, false)];

    renderPage('/stories/draft?preview=1');

    expect(await screen.findByRole('heading', { name: 'Không tìm thấy số đặc san' })).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it.each([
    ['local development', true, 'test'],
    ['the explicit review build', false, 'story-review'],
  ])('loads an explicit draft preview in %s only', async (_label, dev, mode) => {
    vi.stubEnv('DEV', dev);
    vi.stubEnv('MODE', mode);
    const load = vi.fn().mockResolvedValue({ default: story('draft') });
    registry.entries = [entry('draft', load, false)];

    renderPage('/stories/draft?preview=1');

    expect(await screen.findByText('Rendered draft')).toBeInTheDocument();
    expect(screen.getByText('Bản nháp để duyệt, chưa xuất bản.')).toBeVisible();
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute('href', `${location.origin}/stories/draft`);
    expect(load).toHaveBeenCalledOnce();
  });

  it('localizes the visible draft notice in English', async () => {
    vi.stubEnv('DEV', true);
    writeLocalStorage(LANG_STORAGE_KEY, 'en');
    registry.entries = [entry('draft', vi.fn().mockResolvedValue({ default: story('draft') }), false)];

    renderPage('/stories/draft?preview=1');

    expect(await screen.findByText('Review draft, not yet published.')).toBeVisible();
  });

  it('drops a ready draft immediately when preview is removed and restores an adopted robots directive', async () => {
    vi.stubEnv('DEV', true);
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'index,follow';
    robots.dataset.owner = 'existing-shell';
    document.head.append(robots);
    const load = vi.fn().mockResolvedValue({ default: story('draft') });
    registry.entries = [entry('draft', load, false)];

    render(
      <ThemeProvider><LanguageProvider><MemoryRouter initialEntries={['/stories/draft?preview=1']}>
        <Routes><Route path="/stories/:slug" element={<><StoryPage /><StoryRouteControls /></>} /></Routes>
      </MemoryRouter></LanguageProvider></ThemeProvider>,
    );
    expect(await screen.findByText('Rendered draft')).toBeInTheDocument();
    expect(robots).toHaveAttribute('content', 'noindex');

    fireEvent.click(screen.getByRole('button', { name: 'Drop draft preview' }));

    expect(screen.queryByText('Rendered draft')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Không tìm thấy số đặc san' })).toBeInTheDocument();
    expect(robots).toHaveAttribute('content', 'index,follow');
    expect(robots).toHaveAttribute('data-owner', 'existing-shell');
    expect(load).toHaveBeenCalledOnce();
  });
});
