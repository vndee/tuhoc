import { useEffect, useRef, useState } from 'react';

export interface WidgetFrameProps {
  /** The widget's own name (the course package's `widgets/<name>/`). Doubles as the iframe's `title` — there is nothing else here worth a screen reader announcing. */
  name: string;
  /** The widget's whole `index.html`, byte-for-byte — already checked at publish time by the `WIDGET_*` rules (Tasks 2/7) and re-run server-side, so this component's only job is to run it somewhere it cannot do harm. */
  html: string;
}

/**
 * One widget, running behind the entire security boundary this task exists
 * to build.
 *
 * `sandbox="allow-scripts"` — and stopping there — puts the iframe in an
 * OPAQUE origin: no cookies, no storage, no reach into `window.parent`, and
 * any request the widget makes carries none of the reader's credentials.
 * That is the whole product; every other line in this file and in
 * `ChapterView.tsx`'s widget-mounting code is plumbing around it.
 *
 * NEVER add `allow-same-origin` next to `allow-scripts`. The pair together
 * is the one documented way to defeat this sandbox entirely — a
 * same-origin, script-running frame can read `document.cookie`,
 * `localStorage`, and `window.parent` on the page that embeds it, which on
 * this platform is the reader's own logged-in session (and, from a later
 * phase, its credit wallet). If a future widget genuinely needs to tell the
 * page something, the answer is `postMessage` from inside the sandbox, not
 * loosening the sandbox itself.
 *
 * `srcDoc`, not `src`: the widget's HTML is a string this component already
 * holds (served inline by the chapter endpoint — see `ChapterPayload` in
 * `api/catalog.ts`), not a resource with a URL of its own. Handing it to
 * `src` would mean serving it as a same-origin request under this app's own
 * path space for no reason `srcDoc` doesn't already solve, and would invite
 * "just fetch it and cache it" changes that have nothing to do with what
 * this component is for.
 *
 * Sizing: a `sandbox="allow-scripts"` iframe with no `allow-same-origin` is
 * cross-origin from the parent's point of view, so this page cannot reach in
 * and MEASURE the widget. `.widget-frame` (reader-layout.css) therefore gives
 * every widget a fixed default height. An earlier version of this comment
 * went one step further and said the widget could not report its height
 * back either — that was wrong, and the paragraph above already had the
 * answer: `postMessage` works fine out of an opaque origin. Measured on the
 * first real course (58 canvas figures with controls and a readout row),
 * roughly a third of them ran to 450–490px inside a 420px frame, and with
 * macOS overlay scrollbars the clipped readout simply looked cut off.
 *
 * So the widget MAY tell us. Protocol, deliberately tiny:
 *   `parent.postMessage({ type: 'tuhoc:widget-height', height: <px> }, '*')`
 * The handler below accepts a message only when `event.source` is THIS
 * iframe's own window (a widget cannot size a sibling, and no other frame on
 * the page can size this one), reads nothing but a finite number out of it,
 * and clamps it to 160–1400px so a hostile or buggy widget cannot collapse
 * to nothing or push the chapter off the page. A widget that never sends
 * anything keeps the CSS default — `fixtures/format-v2/valid-course`'s
 * counter widget is exactly that, and it is still correct. Nothing about
 * the sandbox attribute changes; this is the "postMessage from inside"
 * path the paragraph above names, not a relaxation of it.
 */
export const WIDGET_HEIGHT_MESSAGE = 'tuhoc:widget-height';
const WIDGET_MIN_HEIGHT = 160;
const WIDGET_MAX_HEIGHT = 1400;

export function WidgetFrame({ name, html }: WidgetFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const frame = ref.current;
      if (frame === null || event.source !== frame.contentWindow) return;
      const data: unknown = event.data;
      if (typeof data !== 'object' || data === null) return;
      const { type, height: raw } = data as { type?: unknown; height?: unknown };
      if (type !== WIDGET_HEIGHT_MESSAGE || typeof raw !== 'number' || !Number.isFinite(raw)) return;
      setHeight(Math.min(WIDGET_MAX_HEIGHT, Math.max(WIDGET_MIN_HEIGHT, Math.round(raw))));
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <iframe
      ref={ref}
      className="widget-frame"
      title={name}
      sandbox="allow-scripts"
      srcDoc={html}
      style={height === null ? undefined : { height }}
    />
  );
}
