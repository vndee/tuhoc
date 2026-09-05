export interface ObserverHarness {
  emit(id: string, isIntersecting?: boolean): void;
  emitMany(entries: Array<{ id: string; isIntersecting: boolean; top: number }>): void;
  latestRoot(): Element | Document | null;
  restore(): void;
}

/** A small deterministic observer replacement for story-scroll tests. */
export function installIntersectionObserver(): ObserverHarness {
  const original = globalThis.IntersectionObserver;
  const instances: Array<{ callback: IntersectionObserverCallback; options?: IntersectionObserverInit }> = [];

  class FakeObserver {
    root = null;
    rootMargin = '';
    thresholds = [0];

    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      instances.push({ callback, options });
    }

    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }

  globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;

  return {
    emit(id, isIntersecting = true) {
      const target = document.getElementById(id)!;
      instances.at(-1)!.callback([
        { target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 } as unknown as IntersectionObserverEntry,
      ], {} as IntersectionObserver);
    },
    emitMany(entries) {
      instances.at(-1)!.callback(entries.map(({ id, isIntersecting, top }) => {
        const target = document.getElementById(id)!;
        Object.defineProperty(target, 'getBoundingClientRect', {
          configurable: true,
          value: () => ({ top }),
        });
        return {
          target,
          isIntersecting,
          intersectionRatio: isIntersecting ? 1 : 0,
          boundingClientRect: { top },
        } as unknown as IntersectionObserverEntry;
      }), {} as IntersectionObserver);
    },
    latestRoot: () => instances.at(-1)?.options?.root ?? null,
    restore: () => { globalThis.IntersectionObserver = original; },
  };
}
