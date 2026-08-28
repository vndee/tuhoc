import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WidgetFrame } from './WidgetFrame';

/**
 * `WidgetFrame` is the entire security boundary between a course's
 * (untrusted) interactive content and the reader's session — see its own
 * doc comment. These three tests are deliberately narrow: this component has
 * exactly one job, and the FIRST test below is the one that matters most in
 * this whole task.
 */
describe('WidgetFrame', () => {
  it('sandboxes the iframe to EXACTLY "allow-scripts" — no allow-same-origin, ever', () => {
    render(<WidgetFrame name="dao-ham" html="<p>xin chào</p>" />);

    // Equality, NOT `toContain`. `"allow-scripts allow-same-origin"` would
    // satisfy a `toContain('allow-scripts')` check while handing the widget
    // the parent's origin — the exact regression this test exists to catch.
    // This assertion must go red the moment that token is added.
    expect(screen.getByTitle('dao-ham')).toHaveAttribute('sandbox', 'allow-scripts');
  });

  it('carries the widget\'s own html verbatim via srcDoc, not src', () => {
    render(<WidgetFrame name="dao-ham" html="<p>nội dung widget</p>" />);

    const frame = screen.getByTitle('dao-ham') as HTMLIFrameElement;
    expect(frame.srcdoc).toBe('<p>nội dung widget</p>');
    // No `src`: this markup has no URL of its own to fetch from, and giving
    // it one would mean serving the widget as a request the sandbox is built
    // to avoid needing.
    expect(frame).not.toHaveAttribute('src');
  });

  it("uses the widget's own name as the iframe's accessible name (title)", () => {
    render(<WidgetFrame name="do-thi-ham-so" html="<p>x</p>" />);

    expect(screen.getByTitle('do-thi-ham-so').tagName).toBe('IFRAME');
  });
});
