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
 * cross-origin from the parent's point of view, so neither side can measure
 * the other — the widget cannot report its content height back, and this
 * page cannot reach in and read it. `.widget-frame` (reader-layout.css)
 * therefore gives every widget a fixed height rather than trying to fit its
 * content. That is an accepted limitation of the design, not a defect to
 * "fix" by relaxing the sandbox above.
 */
export function WidgetFrame({ name, html }: WidgetFrameProps) {
  return (
    <iframe
      className="widget-frame"
      title={name}
      sandbox="allow-scripts"
      srcDoc={html}
    />
  );
}
