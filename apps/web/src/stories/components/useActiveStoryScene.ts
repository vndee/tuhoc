import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { StoryScene } from '../types';
import { activeStoryScenePrivateContext, findOwnedElement } from './StoryRendererInternals';

export interface ActiveStoryScene {
  activeSceneId: string;
  activeIndex: number;
  coverPassed: boolean;
  setActiveSceneId: (id: string) => void;
}

function validHashId(scenes: StoryScene[]): StoryScene['id'] | null {
  if (!location.hash) return null;
  try {
    const id = decodeURIComponent(location.hash.slice(1)) as StoryScene['id'];
    return scenes.some((scene) => scene.id === id) ? id : null;
  } catch {
    return null;
  }
}

function entryTop(entry: IntersectionObserverEntry): number {
  return entry.boundingClientRect?.top ?? entry.target.getBoundingClientRect().top;
}

function elementTop(element: Element): number {
  return element.getBoundingClientRect().top;
}

function rootGeometry(root: Element | null) {
  if (!root) return { top: 0, height: window.innerHeight };
  const rect = root.getBoundingClientRect();
  return { top: rect.top, height: root.clientHeight || rect.height || window.innerHeight };
}

/** Maps the browser viewport's 45% reading line to a scene without changing focus. */
export function useActiveStoryScene(scenes: StoryScene[]): ActiveStoryScene {
  const privateConfig = useContext(activeStoryScenePrivateContext);
  const sceneIds = useMemo(() => new Set(scenes.map((scene) => scene.id)), [scenes]);
  const initialId = useMemo(() => (privateConfig.honorHash ? validHashId(scenes) : null) ?? scenes[0]?.id ?? '', [privateConfig.honorHash, scenes]);
  const [activeSceneId, setActiveId] = useState<string>(() => initialId);
  const [coverPassed, setCoverPassed] = useState(false);
  const intersections = useRef(new Map<string, Element>());
  // A direct hash is an explicit reader request. Intersection callbacks can
  // arrive before its deferred image/font scroll settles (and again while a
  // language change reflows copy), so keep it authoritative through passive
  // layout changes. Explicit scene navigation or reader scroll releases it.
  const pendingHashSceneId = useRef<StoryScene['id'] | null>(
    privateConfig.honorHash ? validHashId(scenes) : null,
  );

  const setActiveSceneId = useCallback((id: string) => {
    if (!sceneIds.has(id as StoryScene['id'])) return;
    if (pendingHashSceneId.current && pendingHashSceneId.current !== id) pendingHashSceneId.current = null;
    setActiveId(id);
    if (location.hash !== `#${id}`) history.replaceState(history.state, '', `${location.pathname}${location.search}#${id}`);
  }, [sceneIds]);

  useEffect(() => {
    // Editorial pages are descendants of #scroller, but window owns the actual
    // scroll viewport. Using #scroller's document-height box freezes the reading line.
    const root = null;
    const retainedIntersections = intersections.current;
    const selectFromIntersections = () => {
      const candidates = [...retainedIntersections.entries()];
      if (candidates.length === 0) return;
      const pending = pendingHashSceneId.current;
      if (pending) {
        if (retainedIntersections.has(pending)) {
          setActiveSceneId(pending);
        }
        return;
      }
      const geometry = rootGeometry(root);
      const anchor = geometry.top + geometry.height * 0.45;
      const next = candidates.reduce((closest, candidate) => (
        Math.abs(elementTop(candidate[1]) - anchor) < Math.abs(elementTop(closest[1]) - anchor) ? candidate : closest
      ));
      setActiveSceneId(next[0] as StoryScene['id']);
    };

    const observer = new IntersectionObserver((entries) => {
      const geometry = rootGeometry(root);
      let sceneChanged = false;
      entries.forEach((entry) => {
        if (entry.target.id === 'story-cover-sentinel') {
          flushSync(() => setCoverPassed(entryTop(entry) < geometry.top));
          return;
        }
        if (!sceneIds.has(entry.target.id as StoryScene['id'])) return;
        sceneChanged = true;
        if (entry.isIntersecting) retainedIntersections.set(entry.target.id, entry.target);
        else retainedIntersections.delete(entry.target.id);
      });
      if (sceneChanged) flushSync(selectFromIntersections);
    }, {
      root,
      rootMargin: '-45% 0px -45% 0px',
      threshold: [0, 0.01, 1],
    });

    const coverSentinel = findOwnedElement(privateConfig.ownerRoot(), 'story-cover-sentinel') ?? document.getElementById('story-cover-sentinel');
    if (coverSentinel) observer.observe(coverSentinel);
    scenes.forEach((scene) => {
      const element = findOwnedElement(privateConfig.ownerRoot(), scene.id) ?? document.getElementById(scene.id);
      if (element) observer.observe(element);
    });
    // A direct hash remains authoritative across passive reflow (including a
    // language switch). Reader intent is the honest boundary: scene links
    // release in setActiveSceneId, while normal wheel/touch/page navigation
    // releases here so the viewport can choose the next scene.
    const releaseForReaderScroll = (event: Event) => {
      if (!pendingHashSceneId.current) return;
      if (event.type === 'keydown') {
        const key = (event as KeyboardEvent).key;
        if (![' ', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(key)) return;
      }
      pendingHashSceneId.current = null;
      selectFromIntersections();
    };
    window.addEventListener('wheel', releaseForReaderScroll, { passive: true });
    window.addEventListener('touchmove', releaseForReaderScroll, { passive: true });
    window.addEventListener('keydown', releaseForReaderScroll);
    return () => {
      retainedIntersections.clear();
      observer.disconnect();
      window.removeEventListener('wheel', releaseForReaderScroll);
      window.removeEventListener('touchmove', releaseForReaderScroll);
      window.removeEventListener('keydown', releaseForReaderScroll);
    };
  }, [privateConfig, sceneIds, scenes, setActiveSceneId]);

  useEffect(() => {
    if (!privateConfig.honorHash) return;
    const id = validHashId(scenes);
    if (!id) return;
    let canceled = false;
    let rafId: number | null = null;
    const scene = scenes.find((item) => item.id === id)!;
    const image = new Image();
    image.src = scene.illustration.src;
    const decoded = typeof image.decode === 'function'
      ? image.decode().then(() => false, () => true)
      : Promise.resolve(false);
    const fonts = document.fonts?.ready ?? Promise.resolve();
    void Promise.all([decoded, fonts]).then(([decodeFailed]) => {
      if (canceled) return;
      if (decodeFailed) privateConfig.onDecodeFailure(id);
      rafId = requestAnimationFrame(() => {
        if (canceled) return;
        const target = findOwnedElement(privateConfig.ownerRoot(), id) ?? document.getElementById(id);
        if (typeof target?.scrollIntoView === 'function') target.scrollIntoView({ block: 'center' });
      });
    });
    return () => {
      canceled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [privateConfig, scenes]);

  const activeIndex = Math.max(0, scenes.findIndex((scene) => scene.id === activeSceneId));
  return { activeSceneId, activeIndex, coverPassed, setActiveSceneId };
}
