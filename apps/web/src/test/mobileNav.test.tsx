import { render, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import App from '../App';

const server = setupServer(
  http.get('/courses/:courseId/manifest.json', () =>
    HttpResponse.json({
      id: 'demo',
      title: 'Demo',
      description: 'Demo desc',
      lang: 'vi',
      version: '1.0.0',
      runtime: '^1',
      parts: [
        {
          title: 'Phần 1',
          chapters: [{ id: 'c1', num: '1', title: 'Chương một', short: 'Chương một', file: 'chapters/c1.html' }],
        },
      ],
    }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function goTo(path: string) {
  window.history.pushState({}, '', path);
}

describe('mobile TOC drawer (#menu-btn)', () => {
  beforeEach(() => {
    document.body.classList.remove('nav-open');
    goTo('/');
  });

  it('starts closed', () => {
    render(<App />);
    expect(document.body.classList.contains('nav-open')).toBe(false);
  });

  it('opens on menu-btn click and closes on a second click', async () => {
    const user = userEvent.setup();
    render(<App />);
    const menuBtn = document.getElementById('menu-btn')!;

    await user.click(menuBtn);
    expect(document.body.classList.contains('nav-open')).toBe(true);

    await user.click(menuBtn);
    expect(document.body.classList.contains('nav-open')).toBe(false);
  });

  it('closes when Escape is pressed', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(document.getElementById('menu-btn')!);
    expect(document.body.classList.contains('nav-open')).toBe(true);

    await user.keyboard('{Escape}');
    expect(document.body.classList.contains('nav-open')).toBe(false);
  });

  it('closes when the dimmed backdrop (anywhere outside #sidebar/#menu-btn) is tapped', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(document.getElementById('menu-btn')!);
    expect(document.body.classList.contains('nav-open')).toBe(true);

    // body.nav-open::after paints the backdrop; a pseudo-element can't take
    // its own listener, so v1 (and this port) detects the tap as any click
    // landing outside #sidebar/#menu-btn while open. #content stands in.
    await user.click(document.getElementById('content')!);
    expect(document.body.classList.contains('nav-open')).toBe(false);
  });

  it('does NOT close on a click inside #sidebar itself', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(document.getElementById('menu-btn')!);
    expect(document.body.classList.contains('nav-open')).toBe(true);

    await user.click(document.getElementById('sidebar')!);
    expect(document.body.classList.contains('nav-open')).toBe(true);
  });

  it('closes when a chapter is selected (navigation), the superset of "selecting a chapter closes it"', async () => {
    goTo('/c/demo');
    const user = userEvent.setup();
    render(<App />);

    await user.click(document.getElementById('menu-btn')!);
    expect(document.body.classList.contains('nav-open')).toBe(true);

    // The drawer's own sidebar copy and CourseHome's in-page copy both
    // render the same chapter while the drawer is open — scope to #content
    // (the page the reader is actually looking at) to pick one.
    const content = document.getElementById('content')!;
    const chapterLink = await within(content).findByRole('link', { name: /Chương một/ });
    await user.click(chapterLink);
    expect(document.body.classList.contains('nav-open')).toBe(false);
  });
});
