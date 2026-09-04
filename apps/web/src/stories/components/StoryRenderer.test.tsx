import { readFileSync } from 'fs';
import { resolve } from 'path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode, type ComponentProps, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { ThemeProvider } from '../../theme/ThemeContext';
import { installIntersectionObserver, type ObserverHarness } from '../../test/intersectionObserver';
import { makeStoryFixture } from '../testing/storyFixture';
import type { StoryDefinition, StoryScene as StorySceneModel } from '../types';
import { RichText } from './RichText';
import { StoryRenderer } from './StoryRenderer';
import { StoryShell, type StoryShellProps } from './StoryShell';
import * as activeSceneModule from './useActiveStoryScene';
import { useActiveStoryScene, type ActiveStoryScene } from './useActiveStoryScene';

let observer: ObserverHarness;

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/stories/fixture-story');
  observer = installIntersectionObserver();
});
afterEach(() => { observer.restore(); vi.unstubAllGlobals(); vi.useRealTimers(); });

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
const storyRendererApiAssertions = [
  true as Assert<Equal<keyof StoryShellProps, 'variant' | 'children' | 'compact' | 'progress' | 'scenes' | 'activeSceneId'>>,
  true as Assert<Equal<keyof ActiveStoryScene, 'activeSceneId' | 'activeIndex' | 'coverPassed' | 'setActiveSceneId'>>,
  true as Assert<Equal<Parameters<typeof useActiveStoryScene>, [StorySceneModel[]]>>,
];
void storyRendererApiAssertions;

function setMatchMedia(query: string, matches: boolean): void {
  vi.stubGlobal('matchMedia', vi.fn((asked: string) => ({
    matches: asked === query ? matches : false,
    media: asked,
    onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  })));
}

function renderStory(
  story = makeStoryFixture({ sceneCount: 12 }),
  renderLab?: ComponentProps<typeof StoryRenderer>['renderLab'],
) {
  return render(
    <MemoryRouter><LanguageProvider><ThemeProvider>
      <div id="scroller"><StoryRenderer story={story} renderLab={renderLab} /></div>
    </ThemeProvider></LanguageProvider></MemoryRouter>,
  );
}

function renderShell(children: ReactNode = null) {
  return render(
    <MemoryRouter><LanguageProvider><ThemeProvider>
      <div id="scroller">
        <StoryShell
          variant="issue"
          progress={{ current: 1, total: 12 }}
          scenes={[{ id: 'scene-1', label: '01' }, { id: 'scene-5', label: '05' }]}
          activeSceneId="scene-1"
        >
          {children}
        </StoryShell>
      </div>
    </ThemeProvider></LanguageProvider></MemoryRouter>,
  );
}

function renderShellWithoutScenes() {
  return render(
    <MemoryRouter><LanguageProvider><ThemeProvider>
      <StoryShell variant="collection"><p>Collection body</p></StoryShell>
    </ThemeProvider></LanguageProvider></MemoryRouter>,
  );
}

function storyVariant(slug: string, label: string): StoryDefinition {
  const story = makeStoryFixture({ sceneCount: 12 });
  return {
    ...story,
    meta: {
      ...story.meta,
      slug,
      title: { vi: `${label} VI`, en: `${label} EN` },
      cover: {
        ...story.meta.cover,
        src: `/stories/${slug}/cover.webp`,
        alt: { vi: `${label} cover vi`, en: `${label} cover en` },
        caption: { vi: `${label} cover caption vi`, en: `${label} cover caption en` },
      },
    },
    scenes: story.scenes.map((scene) => ({
      ...scene,
      title: { vi: `${label} ${scene.id} vi`, en: `${label} ${scene.id} en` },
      illustration: {
        ...scene.illustration,
        src: `/stories/${slug}/${scene.id}.webp`,
        srcSet: `/stories/${slug}/${scene.id}.webp 1200w`,
        alt: { vi: `${label} ${scene.id} art vi`, en: `${label} ${scene.id} art en` },
        caption: { vi: `${label} ${scene.id} caption vi`, en: `${label} ${scene.id} caption en` },
      },
      lab: {
        ...scene.lab,
        kind: slug === 'story-b' ? 'embodied-calculation' : 'external-memory',
        title: { vi: `${label} lab vi`, en: `${label} lab en` },
      } as typeof scene.lab,
    })),
  };
}

function setRootGeometry(top: number, height: number): void {
  const scroller = document.getElementById('scroller')!;
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: height });
  Object.defineProperty(scroller, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ top, bottom: top + height, height, left: 0, right: 1000, width: 1000, x: 0, y: top, toJSON: () => ({}) }),
  });
}

function plateImages() {
  return screen.getAllByTestId('story-plate-image') as HTMLImageElement[];
}

function plateImageFor(srcPart: string): HTMLImageElement {
  const image = plateImages().find((item) => item.getAttribute('src')?.includes(srcPart));
  if (!image) throw new Error(`missing plate image ${srcPart}`);
  return image;
}

function stageLayers() {
  return Array.from(screen.getByTestId('story-stage').querySelectorAll<HTMLElement>('.story-plate-layer'));
}

function setElementTop(id: string, top: number): void {
  const target = document.getElementById(id)!;
  Object.defineProperty(target, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ top, bottom: top + 100, height: 100, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) }),
  });
}

function installControlledImage(decode: () => Promise<unknown> = () => Promise.resolve()) {
  const instances: Array<{ src: string; decode: () => Promise<unknown> }> = [];
  class FakeImage {
    #src = '';
    set src(next: string) { this.#src = next; }
    get src() { return this.#src; }
    decode = vi.fn(() => decode());
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      instances.push(this as unknown as { src: string; decode: () => Promise<unknown> });
    }
  }
  vi.stubGlobal('Image', FakeImage);
  return { instances };
}

function deferred<T = void>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

describe('StoryRenderer', () => {
  it('keeps renderer coordination out of the public active-scene hook module exports', () => {
    expect(Object.keys(activeSceneModule)).toEqual(['useActiveStoryScene']);
  });

  it('renders repeated rich-text list items without duplicate key warnings', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<RichText blocks={[{ kind: 'list', items: ['repeat', 'repeat'] }]} />);
    expect(screen.getAllByText('repeat')).toHaveLength(2);
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('Encountered two children with the same key'));
    consoleError.mockRestore();
  });

  it('uses #scroller as observer root and replaces the hash without growing history', () => {
    const replace = vi.spyOn(history, 'replaceState');
    renderStory();
    expect(observer.latestRoot()).toBe(document.getElementById('scroller'));
    observer.emit('scene-5');
    expect(screen.getByText('05 / 12')).toBeVisible();
    expect(replace).toHaveBeenLastCalledWith(history.state, '', expect.stringMatching(/#scene-5$/));
  });

  it('lets direct StoryShell scene links replace the hash and scroll without public callbacks or focus moves', () => {
    const replace = vi.spyOn(history, 'replaceState');
    const push = vi.spyOn(history, 'pushState');
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderShell(<section id="scene-5" tabIndex={-1}>Target scene</section>);
    const language = screen.getByRole('button', { name: /ngôn ngữ/i });
    language.focus();
    fireEvent.click(screen.getByRole('link', { name: '05' }));
    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenLastCalledWith(history.state, '', expect.stringMatching(/#scene-5$/));
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
    expect(document.activeElement).toBe(language);
    vi.restoreAllMocks();
  });

  it('isolates scene activation and scroll targets between simultaneous renderers with overlapping scene ids', () => {
    const replace = vi.spyOn(history, 'replaceState');
    const firstStory = storyVariant('story-a', 'Story A');
    const secondStory = storyVariant('story-b', 'Story B');
    render(
      <MemoryRouter><LanguageProvider><ThemeProvider>
        <div id="scroller">
          <section aria-label="first renderer"><StoryRenderer story={firstStory} /></section>
          <section aria-label="second renderer"><StoryRenderer story={secondStory} /></section>
        </div>
      </ThemeProvider></LanguageProvider></MemoryRouter>,
    );

    const first = screen.getByRole('region', { name: 'first renderer' });
    const second = screen.getByRole('region', { name: 'second renderer' });
    const firstScene5 = within(first).getByRole('heading', { name: /Story A scene-5 vi/i }).closest('article')!;
    const secondScene5 = within(second).getByRole('heading', { name: /Story B scene-5 vi/i }).closest('article')!;
    const firstScroll = vi.fn();
    const secondScroll = vi.fn();
    firstScene5.scrollIntoView = firstScroll;
    secondScene5.scrollIntoView = secondScroll;

    fireEvent.click(within(second).getAllByRole('link', { name: '05' })[0]!);

    expect(within(first).getByText('01 / 12')).toBeVisible();
    expect(within(second).getByText('05 / 12')).toBeVisible();
    expect(firstScroll).not.toHaveBeenCalled();
    expect(secondScroll).toHaveBeenCalledWith({ block: 'center' });
    expect(replace).toHaveBeenLastCalledWith(history.state, '', expect.stringMatching(/#scene-5$/));
    vi.restoreAllMocks();
  });

  it('chooses the intersecting scene nearest the 45 percent anchor with root offset', () => {
    renderStory();
    setRootGeometry(100, 1000);
    observer.emitMany([
      { id: 'scene-4', isIntersecting: true, top: 500 },
      { id: 'scene-5', isIntersecting: true, top: 560 },
    ]);
    expect(screen.getByText('05 / 12')).toBeVisible();
  });

  it('updates active scene from retained intersections on exit-only callbacks', () => {
    renderStory();
    setRootGeometry(0, 1000);
    observer.emitMany([
      { id: 'scene-1', isIntersecting: true, top: 450 },
      { id: 'scene-2', isIntersecting: true, top: 700 },
    ]);
    expect(screen.getByText('01 / 12')).toBeVisible();
    observer.emitMany([{ id: 'scene-1', isIntersecting: false, top: -100 }]);
    expect(screen.getByText('02 / 12')).toBeVisible();
  });

  it('samples live target geometry for retained intersections when another scene triggers selection', () => {
    renderStory();
    setRootGeometry(0, 1000);
    observer.emitMany([
      { id: 'scene-1', isIntersecting: true, top: 450 },
      { id: 'scene-2', isIntersecting: true, top: 900 },
    ]);
    expect(screen.getByText('01 / 12')).toBeVisible();
    setElementTop('scene-1', 900);
    observer.emitMany([{ id: 'scene-2', isIntersecting: true, top: 460 }]);
    expect(screen.getByText('02 / 12')).toBeVisible();
  });

  it('keeps the header full while the cover sentinel is below and compacts after it passes above', () => {
    const { container } = renderStory();
    setRootGeometry(0, 1000);
    observer.emitMany([{ id: 'story-cover-sentinel', isIntersecting: false, top: 1200 }]);
    expect(container.querySelector('.story-shell')).not.toHaveClass('is-compact');
    observer.emitMany([{ id: 'story-cover-sentinel', isIntersecting: false, top: -20 }]);
    expect(container.querySelector('.story-shell')).toHaveClass('is-compact');
  });

  it('opens a valid initial deep link after image decode, fonts, and RAF while leaving invalid hashes untouched', async () => {
    const decoded = deferred();
    const fonts = deferred();
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    installControlledImage(() => decoded.promise);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: fonts.promise } });
    history.replaceState(null, '', '/stories/fixture-story#scene-5');
    renderStory();
    expect(screen.getByTestId('story-stage')).toHaveAttribute('data-active-scene', 'scene-5');
    expect(scroll).not.toHaveBeenCalled();
    decoded.resolve();
    await act(async () => { await Promise.resolve(); });
    expect(scroll).not.toHaveBeenCalled();
    fonts.resolve();
    await act(async () => { await Promise.resolve(); });
    expect(raf).toHaveBeenCalled();
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
    vi.restoreAllMocks();
    history.replaceState(null, '', '/stories/fixture-story#not-a-scene');
    renderStory();
    expect(location.hash).toBe('#not-a-scene');
  });

  it('does not crash on malformed hashes and cancels pending deep-link scroll work on unmount', async () => {
    const decoded = deferred();
    const fonts = deferred();
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 9);
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame');
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    installControlledImage(() => decoded.promise);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: fonts.promise } });

    history.replaceState(null, '', '/stories/fixture-story#%E0%A4%A');
    expect(() => renderStory()).not.toThrow();
    expect(location.hash).toBe('#%E0%A4%A');

    history.replaceState(null, '', '/stories/fixture-story#scene-5');
    const view = renderStory();
    view.unmount();
    decoded.resolve();
    fonts.resolve();
    await act(async () => { await Promise.resolve(); });
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(cancelAnimationFrame).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('cancels an already scheduled deep-link RAF when unmounted before the frame runs', async () => {
    const decoded = deferred();
    const fonts = deferred();
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 77);
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame');
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    installControlledImage(() => decoded.promise);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: fonts.promise } });
    history.replaceState(null, '', '/stories/fixture-story#scene-5');
    const view = renderStory();
    decoded.resolve();
    fonts.resolve();
    await act(async () => { await Promise.resolve(); });
    expect(requestAnimationFrame).toHaveBeenCalled();
    view.unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(77);
    expect(scroll).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('treats rejected deep-link image decode as an active plate fallback and works without document.fonts', async () => {
    installControlledImage(() => Promise.reject(new Error('decode failed')));
    Object.defineProperty(document, 'fonts', { configurable: true, value: undefined });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    history.replaceState(null, '', '/stories/fixture-story#scene-5');
    renderStory();
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('story-stage')).toHaveAttribute('data-active-scene', 'scene-5');
    expect(screen.getByText(/minh hoạ không tải được/i)).toBeVisible();
    vi.restoreAllMocks();
  });

  it('loads scene changes in the hidden permanent layer and survives A to B to C races', async () => {
    vi.useFakeTimers();
    renderStory();
    setRootGeometry(0, 1000);
    observer.emitMany([{ id: 'scene-2', isIntersecting: true, top: 450 }]);
    expect(screen.getByTestId('story-stage')).toHaveAttribute('data-active-scene', 'scene-1');
    const scene2 = plateImageFor('scene-2.webp');
    expect(scene2.closest('.story-plate-layer')).not.toHaveClass('is-active');
    fireEvent.load(scene2);
    expect(screen.getByTestId('story-stage')).toHaveAttribute('data-active-scene', 'scene-2');
    observer.emitMany([
      { id: 'scene-2', isIntersecting: false, top: -100 },
      { id: 'scene-3', isIntersecting: true, top: 450 },
    ]);
    await act(() => vi.advanceTimersByTimeAsync(360));
    fireEvent.load(plateImageFor('scene-3.webp'));
    expect(screen.getByTestId('story-stage')).toHaveAttribute('data-active-scene', 'scene-3');
    expect(plateImageFor('scene-3.webp')).toBeVisible();
  });

  it('keeps retiring physical layers for exactly 360ms before mounting the newest queued request', async () => {
    vi.useFakeTimers();
    renderStory();
    setRootGeometry(0, 1000);
    expect(stageLayers()[0]).toHaveAttribute('data-scene', 'scene-1');
    expect(stageLayers()[0]).not.toHaveAttribute('aria-hidden');
    observer.emitMany([{ id: 'scene-2', isIntersecting: true, top: 450 }]);
    expect(stageLayers()[1]).toHaveAttribute('data-scene', 'scene-2');
    expect(stageLayers()[1]).toHaveAttribute('aria-hidden', 'true');
    fireEvent.load(plateImageFor('scene-2.webp'));
    expect(stageLayers()[0]).toHaveAttribute('data-scene', 'scene-1');
    expect(stageLayers()[0]).toHaveAttribute('aria-hidden', 'true');
    expect(stageLayers()[1]).toHaveAttribute('data-scene', 'scene-2');
    expect(stageLayers()[1]).not.toHaveAttribute('aria-hidden');

    observer.emitMany([
      { id: 'scene-2', isIntersecting: false, top: -100 },
      { id: 'scene-3', isIntersecting: true, top: 450 },
    ]);
    expect(stageLayers()[0]).toHaveAttribute('data-scene', 'scene-1');
    expect(screen.queryByRole('img', { name: /minh họa cảnh 3/i })).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(359));
    expect(stageLayers()[0]).toHaveAttribute('data-scene', 'scene-1');
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(stageLayers()[0]).toHaveAttribute('data-scene', 'scene-3');
    expect(stageLayers()[0]).toHaveAttribute('aria-hidden', 'true');
    fireEvent.load(plateImageFor('scene-3.webp'));
    expect(stageLayers()[0]).toHaveAttribute('data-scene', 'scene-3');
    expect(stageLayers()[0]).not.toHaveAttribute('aria-hidden');
    expect(stageLayers()[1]).toHaveAttribute('data-scene', 'scene-2');
    expect(stageLayers()[1]).toHaveAttribute('aria-hidden', 'true');
  });

  it('reuses a just-retired layer immediately when reduced motion makes retirement 0ms', () => {
    setMatchMedia('(prefers-reduced-motion: reduce)', true);
    renderStory();
    setRootGeometry(0, 1000);
    observer.emitMany([{ id: 'scene-2', isIntersecting: true, top: 450 }]);
    fireEvent.load(plateImageFor('scene-2.webp'));
    expect(screen.getByTestId('story-stage')).toHaveStyle({ '--story-crossfade-ms': '0ms' });
    expect(stageLayers()[0]).not.toHaveAttribute('data-scene');
    observer.emitMany([
      { id: 'scene-2', isIntersecting: false, top: -100 },
      { id: 'scene-3', isIntersecting: true, top: 450 },
    ]);
    expect(stageLayers()[0]).toHaveAttribute('data-scene', 'scene-3');
    fireEvent.load(plateImageFor('scene-3.webp'));
    expect(screen.getByTestId('story-stage')).toHaveAttribute('data-active-scene', 'scene-3');
  });

  it('activates a failed scene fallback when re-entering that scene later', async () => {
    vi.useFakeTimers();
    installControlledImage(() => Promise.reject(new Error('decode failed')));
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    history.replaceState(null, '', '/stories/fixture-story#scene-5');
    renderStory();
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('story-stage')).toHaveAttribute('data-active-scene', 'scene-5');
    expect(stageLayers().find((layer) => layer.dataset.scene === 'scene-5')).not.toHaveAttribute('aria-hidden');
    observer.emitMany([
      { id: 'scene-5', isIntersecting: false, top: -100 },
      { id: 'scene-6', isIntersecting: true, top: 450 },
    ]);
    fireEvent.load(plateImageFor('scene-6.webp'));
    await act(() => vi.advanceTimersByTimeAsync(360));
    observer.emitMany([
      { id: 'scene-6', isIntersecting: false, top: -100 },
      { id: 'scene-5', isIntersecting: true, top: 450 },
    ]);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('story-stage')).toHaveAttribute('data-active-scene', 'scene-5');
    expect(screen.getByText(/minh hoạ không tải được/i).closest('.story-plate-layer')).not.toHaveAttribute('aria-hidden');
    vi.restoreAllMocks();
  });

  it('ignores stale hidden-layer load events from superseded scene requests', () => {
    renderStory();
    setRootGeometry(0, 1000);
    observer.emitMany([{ id: 'scene-2', isIntersecting: true, top: 450 }]);
    const staleScene2 = plateImageFor('scene-2.webp');
    observer.emitMany([
      { id: 'scene-2', isIntersecting: false, top: -100 },
      { id: 'scene-3', isIntersecting: true, top: 450 },
    ]);
    fireEvent.load(staleScene2);
    expect(screen.getByTestId('story-stage')).toHaveAttribute('data-active-scene', 'scene-1');
    fireEvent.load(plateImageFor('scene-3.webp'));
    expect(screen.getByTestId('story-stage')).toHaveAttribute('data-active-scene', 'scene-3');
  });

  it('renders mobile media and lab in scene order without a sticky stage', () => {
    setMatchMedia('(max-width: 900px)', true);
    renderStory();
    expect(screen.queryByTestId('story-stage')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('story-inline-illustration')).toHaveLength(12);
  });

  it('renders localized public labels and cover issue, scene, and lab counts', () => {
    renderStory();
    expect(screen.getByLabelText('Trang chủ')).toBeInTheDocument();
    expect(screen.getByText('Số 01 · Bài kể tương tác')).toBeVisible();
    expect(screen.getByText('12 cảnh')).toBeVisible();
    expect(screen.getByText('12 lab tương tác')).toBeVisible();
    expect(screen.getByText('Cảnh 01')).toBeVisible();
    expect(screen.getAllByText('Điểm kỹ thuật')[0]).toBeVisible();
    expect(screen.getAllByText('Câu hỏi mở')[0]).toBeVisible();
    expect(screen.getByText('Vĩ thanh')).toBeVisible();
    fireEvent.click(screen.getByText('Hậu trường hình ảnh'));
    expect(screen.getAllByText('Lời nhắc')[0]).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /ngôn ngữ/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /EN/i }));
    expect(screen.getByLabelText('Home')).toBeInTheDocument();
    expect(screen.getByText('Issue 01 · Interactive essay')).toBeVisible();
    expect(screen.getByText('12 scenes')).toBeVisible();
    expect(screen.getByText('12 interactive labs')).toBeVisible();
    expect(screen.getByText('Scene 01')).toBeVisible();
    expect(screen.getByText('Coda')).toBeVisible();
    expect(screen.getAllByText('Technical hinge')[0]).toBeVisible();
    expect(screen.getAllByText('Open question')[0]).toBeVisible();
  });

  it('uses replace-only shell scene links without moving focus', () => {
    const replace = vi.spyOn(history, 'replaceState');
    const push = vi.spyOn(history, 'pushState');
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderStory();
    const language = screen.getByRole('button', { name: /ngôn ngữ/i });
    language.focus();
    fireEvent.click(screen.getAllByRole('link', { name: '05' })[0]!);
    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenLastCalledWith(history.state, '', expect.stringMatching(/#scene-5$/));
    expect(screen.getByText('05 / 12')).toBeVisible();
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
    expect(document.activeElement).toBe(language);
    vi.restoreAllMocks();
  });

  it('opens an inactive desktop scene lab in the stage with controlled content', () => {
    const renderLab = vi.fn((scene) => <p id={`lab-${scene.id}`}>Lab for {scene.id}</p>);
    renderStory(makeStoryFixture({ sceneCount: 12 }), renderLab);
    const scene5 = screen.getByRole('heading', { name: /^cảnh 5$/i }).closest('article')!;
    const button = within(scene5).getByRole('button', { name: /tự tay thử/i });
    fireEvent.click(button);
    expect(screen.getByTestId('story-stage')).toHaveAttribute('data-lab-scene', 'scene-5');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', 'story-lab-scene-5');
    expect(document.getElementById('story-lab-scene-5')).toHaveTextContent('Lab for scene-5');
  });

  it('opens an inactive desktop lab only once under StrictMode', () => {
    const replace = vi.spyOn(history, 'replaceState');
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const renderLab = vi.fn((scene) => <p>Lab for {scene.id}</p>);
    render(
      <StrictMode><MemoryRouter><LanguageProvider><ThemeProvider>
        <div id="scroller"><StoryRenderer story={makeStoryFixture({ sceneCount: 12 })} renderLab={renderLab} /></div>
      </ThemeProvider></LanguageProvider></MemoryRouter></StrictMode>,
    );
    const scene5 = screen.getByRole('heading', { name: /^cảnh 5$/i }).closest('article')!;
    fireEvent.click(within(scene5).getByRole('button', { name: /tự tay thử/i }));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('story-stage')).toHaveAttribute('data-lab-scene', 'scene-5');
    vi.restoreAllMocks();
  });

  it('resets story-owned active, stage, and lab state when the story slug changes', () => {
    const storyA = storyVariant('story-a', 'Story A');
    const storyB = storyVariant('story-b', 'Story B');
    const renderLab = vi.fn((scene, value, onChange) => (
      <button type="button" onClick={() => onChange(`${scene.title.en} saved`)}>
        {String(value ?? 'empty')} {scene.lab.kind}
      </button>
    ));
    history.replaceState(null, '', '/stories/story-a#scene-5');
    const view = renderStory(storyA, renderLab);
    observer.emit('scene-5');
    fireEvent.load(plateImageFor('/story-a/scene-5.webp'));
    fireEvent.click(within(screen.getByRole('heading', { name: /Story A scene-5 vi/i }).closest('article')!).getByRole('button', { name: /tự tay thử/i }));
    fireEvent.click(screen.getByRole('button', { name: /empty external-memory/i }));

    view.rerender(
      <MemoryRouter><LanguageProvider><ThemeProvider>
        <div id="scroller"><StoryRenderer story={storyB} renderLab={renderLab} /></div>
      </ThemeProvider></LanguageProvider></MemoryRouter>,
    );
    expect(screen.getByTestId('story-stage')).toHaveAttribute('data-active-scene', 'scene-1');
    expect(screen.getByRole('img', { name: /Story B scene-1 art vi/i })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('heading', { name: /Story B scene-1 vi/i }).closest('article')!).getByRole('button', { name: /tự tay thử/i }));
    expect(screen.getByRole('button', { name: /empty embodied-calculation/i })).toBeVisible();
    expect(screen.queryByText(/Story A scene-5 en saved/)).not.toBeInTheDocument();
  });

  it('ignores a stale same-URL hash on prop-only story swaps but honors the hash for a changed story route', async () => {
    const decoded = deferred();
    const fonts = deferred();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    installControlledImage(() => decoded.promise);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: fonts.promise } });
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }));
    const storyA = storyVariant('story-a', 'Story A');
    const storyB = storyVariant('story-b', 'Story B');

    history.replaceState(null, '', '/stories/story-a#scene-5');
    const view = renderStory(storyA);
    expect(screen.getByTestId('story-stage')).toHaveAttribute('data-active-scene', 'scene-5');

    view.rerender(
      <MemoryRouter><LanguageProvider><ThemeProvider>
        <div id="scroller"><StoryRenderer story={storyB} /></div>
      </ThemeProvider></LanguageProvider></MemoryRouter>,
    );
    expect(screen.getByTestId('story-stage')).toHaveAttribute('data-active-scene', 'scene-1');
    expect(scroll).not.toHaveBeenCalled();

    history.replaceState(null, '', '/stories/story-b#scene-7');
    view.rerender(
      <MemoryRouter><LanguageProvider><ThemeProvider>
        <div id="scroller"><StoryRenderer story={storyB} /></div>
      </ThemeProvider></LanguageProvider></MemoryRouter>,
    );
    expect(screen.getByTestId('story-stage')).toHaveAttribute('data-active-scene', 'scene-7');
    decoded.resolve();
    fonts.resolve();
    await act(async () => { await Promise.resolve(); });
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
    vi.restoreAllMocks();
  });

  it('keeps the active scene and hash when the language changes', () => {
    renderStory();
    observer.emit('scene-3');
    fireEvent.click(screen.getByRole('button', { name: /ngôn ngữ/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /EN/i }));
    expect(screen.getByText('03 / 12')).toBeVisible();
    expect(location.hash).toBe('#scene-3');
  });

  it('renders semantic scene headings and source disclosures', () => {
    renderStory();
    expect(screen.getByRole('heading', { name: /^cảnh 1$/i, level: 2 })).toBeInTheDocument();
    const disclosure = screen.getAllByText(/nguồn cho cảnh này/i)[0]!.closest('details')!;
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(disclosure.querySelector('summary')!);
    expect(disclosure).toHaveAttribute('open');
  });

  it('renders source and provenance disclosures in story order with external rel attributes', () => {
    renderStory();
    const sourceLinks = screen.getAllByRole('link', { name: /Source [AB]/ });
    expect(sourceLinks[0]).toHaveAttribute('rel', 'noreferrer');
    expect(sourceLinks[0]).toHaveAttribute('target', '_blank');
    fireEvent.click(screen.getByText('Hậu trường hình ảnh'));
    const provenance = screen.getAllByRole('listitem').filter((item) => item.textContent?.includes('editorial-v1'));
    expect(provenance.map((item) => item.textContent?.match(/(cover|scene-\d+)/)?.[1])).toEqual([
      'cover', 'scene-1', 'scene-2', 'scene-3', 'scene-4', 'scene-5', 'scene-6', 'scene-7', 'scene-8', 'scene-9', 'scene-10', 'scene-11', 'scene-12',
    ]);
    expect(provenance[0]).toHaveTextContent('cover.webp');
    expect(provenance[0]).toHaveTextContent('2026-09-04T00:00:00.000Z');
    expect(provenance[0]).toHaveTextContent('image-generator');
    expect(provenance[0]).toHaveTextContent('CC-BY-4.0');
    fireEvent.click(within(provenance[0]!).getByText('Lời nhắc'));
    expect(provenance[0]).toHaveTextContent('Fixture cover');
  });

  it('reveals a localized fixed-aspect fallback after an image error', () => {
    setMatchMedia('(max-width: 900px)', true);
    renderStory();
    fireEvent.error(screen.getAllByRole('img', { name: /minh họa cảnh 1/i })[0]!);
    expect(screen.getByText(/minh hoạ không tải được/i)).toBeVisible();
    expect(screen.getAllByTestId('story-inline-illustration')[0]).toHaveStyle({ aspectRatio: '1200 / 800' });
  });

  it('reveals a localized fixed-aspect fallback after a cover image error', () => {
    renderStory();
    fireEvent.error(screen.getByRole('img', { name: /bìa câu chuyện mẫu/i }));
    expect(screen.getByText(/minh hoạ không tải được/i)).toBeVisible();
    expect(screen.getByText(/chú thích bìa/i)).toBeVisible();
    expect(screen.getByTestId('story-cover-plate')).toHaveStyle({ aspectRatio: '1200 / 800' });
  });

  it('uses zero transition duration for reduced motion', () => {
    setMatchMedia('(prefers-reduced-motion: reduce)', true);
    renderStory();
    expect(screen.getByTestId('story-stage')).toHaveStyle({ '--story-crossfade-ms': '0ms' });
  });

  it('does not move focus when scroll activation changes scenes', () => {
    renderStory();
    const button = screen.getByRole('button', { name: /ngôn ngữ/i });
    button.focus();
    observer.emit('scene-3');
    expect(document.activeElement).toBe(button);
  });

  it('keeps every desktop narrative in the document while emphasizing one active scene', () => {
    renderStory();
    observer.emit('scene-2');
    expect(screen.getByText('Câu chuyện Việt 1')).toBeVisible();
    expect(screen.getByText('Câu chuyện Việt 2').closest('article')).toHaveClass('is-active');
  });

  it('mounts a custom lab only when its scene lab is open', () => {
    const renderLab = vi.fn((scene) => <p>Lab for {scene.id}</p>);
    renderStory(makeStoryFixture({ sceneCount: 12 }), renderLab);
    expect(renderLab).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: /tự tay thử/i })[0]!);
    expect(renderLab).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Lab for scene-1')).toBeVisible();
  });

  it('renders a non-main shell root and a truthful non-modal mobile drawer that closes on selection', () => {
    setMatchMedia('(max-width: 900px)', true);
    const { container } = renderStory();
    expect(container.querySelector('main.story-shell')).not.toBeInTheDocument();
    expect(container.querySelector('.story-shell')?.tagName).toBe('DIV');
    const trigger = screen.getByRole('button', { name: /mục lục/i });
    expect(trigger).toHaveAttribute('aria-controls', 'story-contents-drawer');
    fireEvent.click(trigger);
    const drawer = screen.getByRole('region', { name: /mục lục/i });
    expect(drawer).toHaveAttribute('id', 'story-contents-drawer');
    expect(drawer).not.toHaveAttribute('aria-modal');
    expect(document.activeElement).toBe(within(drawer).getByRole('link', { name: '01' }));
    fireEvent.click(within(drawer).getByRole('link', { name: '05' }));
    expect(screen.queryByRole('region', { name: /mục lục/i })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: /mục lục/i })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(screen.getByRole('link', { name: /trở lại các số đặc san/i })).toBeVisible();
  });

  it('does not render an empty Contents navigation landmark for collection shells without scenes', () => {
    renderShellWithoutScenes();
    expect(screen.getByText('Collection body')).toBeVisible();
    expect(screen.queryByRole('navigation', { name: /mục lục/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mục lục/i })).not.toBeInTheDocument();
  });

  it('declares the required responsive and compact CSS contracts', () => {
    const css = readFileSync(resolve(__dirname, '../../styles/stories.css'), 'utf-8');
    expect(css).toContain('--story-shell-offset');
    expect(css).toMatch(/--story-target-size:\s*44px/);
    expect(css).toMatch(/--story-header-border:\s*1px/);
    expect(css).toMatch(/--story-shell-offset:\s*calc\(\(var\(--story-target-size\) \* 2\) \+ var\(--story-header-gap\) \+ \(var\(--story-header-padding-block\) \* 2\) \+ var\(--story-header-border\)\)/);
    expect(css).toMatch(/\.story-shell-header\s*\{[\s\S]*?box-sizing:\s*border-box/);
    expect(css).not.toMatch(/\.story-shell-header\s*\{(?:(?!box-sizing:\s*border-box)[\s\S])*?min-height:\s*var\(--story-shell-offset\)/);
    expect(css).toMatch(/\.story-theme-toggle,[\s\S]*?\.story-all-sources summary\s*\{[\s\S]*?box-sizing:\s*border-box/);
    expect(css).toMatch(/height:\s*calc\(100dvh - var\(--story-shell-offset\)\)/);
    expect(css).toMatch(/\.story-shell\.is-compact\s+\.story-shell-header/);
    expect(css).toMatch(/\.story-shell-tools\s*\{[^}]*flex-wrap:\s*wrap/s);
    expect(css).toMatch(/\.story-contents-drawer\s*\{[^}]*max-height:[^;}]+/s);
    expect(css).toMatch(/\.story-contents-drawer\s*\{[^}]*overflow-y:\s*auto/s);
    expect(css).not.toMatch(/\.story-shell-back\s*\{[^}]*display:\s*none/s);
  });
});
