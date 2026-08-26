import { describe, expect, it } from 'vitest';
import { rewriteAssetUrls } from './rewriteAssetUrls';

/**
 * Review round (final whole-branch review), Important 2: `ChapterView` sets
 * a chapter's HTML via `container.innerHTML = data.html` and never rewrote
 * a relative `src`/`href` — so `<img src="images/fig1.png">` resolved
 * against the SPA's OWN document URL (`/c/<course>/<chapter>`), not the
 * package it came from, and silently hit the `/* -> /index.html` fallback
 * instead of the real asset. `assetUrl(courseId, path)` (`api/catalog.ts`)
 * already built the right URL; nothing called it. This file is the DOM
 * walk that closes that gap, in the same style as
 * `injectExerciseCheckboxes.ts` — a plain function over a container
 * `ChapterView` already owns via a ref, not a React tree.
 */
function fragment(html: string): HTMLDivElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

describe('rewriteAssetUrls', () => {
  it('rewrites a package-relative img[src] through assetUrl', () => {
    const container = fragment('<img src="images/fig1.png" alt="hình 1">');
    rewriteAssetUrls(container, 'so-dau-phay-dong');

    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/courses/so-dau-phay-dong/assets/images/fig1.png');
  });

  it('rewrites a package-relative source[src] (e.g. inside <picture>/<video>) through assetUrl', () => {
    const container = fragment('<picture><source src="images/fig1.webp"><img src="images/fig1.png"></picture>');
    rewriteAssetUrls(container, 'demo');

    expect(container.querySelector('source')?.getAttribute('src')).toBe('/courses/demo/assets/images/fig1.webp');
  });

  it('rewrites a package-relative a[href] (e.g. a link to a downloadable worksheet) through assetUrl', () => {
    const container = fragment('<a href="files/bai-tap.pdf">Tải bài tập</a>');
    rewriteAssetUrls(container, 'demo');

    expect(container.querySelector('a')?.getAttribute('href')).toBe('/courses/demo/assets/files/bai-tap.pdf');
  });

  it('percent-encodes each path segment via assetUrl, keeping the slashes (Vietnamese file/dir names)', () => {
    const container = fragment('<img src="tên có dấu/hình 1.png">');
    rewriteAssetUrls(container, 'demo');

    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/courses/demo/assets/t%C3%AAn%20c%C3%B3%20d%E1%BA%A5u/h%C3%ACnh%201.png',
    );
  });

  it('rewrites every matching element under the container, not just the first', () => {
    const container = fragment(
      '<img src="a.png"><p><img src="b/c.png"></p>',
    );
    rewriteAssetUrls(container, 'demo');

    const [first, second] = Array.from(container.querySelectorAll('img'));
    expect(first.getAttribute('src')).toBe('/courses/demo/assets/a.png');
    expect(second.getAttribute('src')).toBe('/courses/demo/assets/b/c.png');
  });

  it('leaves an absolute http(s) URL untouched — format v2 allows linking/embedding an external resource by full URL', () => {
    const container = fragment('<img src="https://cdn.example.com/fig1.png">');
    rewriteAssetUrls(container, 'demo');

    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/fig1.png');
  });

  it('leaves a protocol-relative URL untouched', () => {
    const container = fragment('<img src="//cdn.example.com/fig1.png">');
    rewriteAssetUrls(container, 'demo');

    expect(container.querySelector('img')?.getAttribute('src')).toBe('//cdn.example.com/fig1.png');
  });

  it('leaves a #fragment-only link untouched (in-page cross-reference)', () => {
    const container = fragment('<a href="#sec-a">Xem Phần A</a>');
    rewriteAssetUrls(container, 'demo');

    expect(container.querySelector('a')?.getAttribute('href')).toBe('#sec-a');
  });

  it('leaves a mailto: link untouched', () => {
    const container = fragment('<a href="mailto:teacher@example.com">Liên hệ</a>');
    rewriteAssetUrls(container, 'demo');

    expect(container.querySelector('a')?.getAttribute('href')).toBe('mailto:teacher@example.com');
  });

  it('leaves a tel: link untouched', () => {
    const container = fragment('<a href="tel:+84123456789">Gọi</a>');
    rewriteAssetUrls(container, 'demo');

    expect(container.querySelector('a')?.getAttribute('href')).toBe('tel:+84123456789');
  });

  it('leaves a data: URI untouched', () => {
    const container = fragment('<img src="data:image/png;base64,iVBORw0KGgo=">');
    rewriteAssetUrls(container, 'demo');

    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('leaves an origin-absolute path ("/...") untouched — never a valid package-relative path (pkgcheck rejects a leading "/")', () => {
    const container = fragment('<img src="/favicon.svg">');
    rewriteAssetUrls(container, 'demo');

    expect(container.querySelector('img')?.getAttribute('src')).toBe('/favicon.svg');
  });

  it('does nothing (no throw) when there are no matching elements at all', () => {
    const container = fragment('<p>Chỉ văn xuôi, không hình, không liên kết.</p>');
    expect(() => rewriteAssetUrls(container, 'demo')).not.toThrow();
  });
});
