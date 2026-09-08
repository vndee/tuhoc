/**
 * Rewrites a chapter fragment's package-relative `img[src]`, `source[src]`
 * and `a[href]` values into real, fetchable URLs before the reader ever
 * lays eyes on them.
 *
 * ## Why this exists (final whole-branch review, Important 2)
 *
 * `ChapterView` sets a chapter's HTML with `container.innerHTML = data.html`
 * — a plain DOM write, not React, so nothing walks the resulting tree
 * afterward on its own. A course package can reference its own images
 * (`<img src="images/fig1.png">`) or files (`<a href="files/bai-tap.pdf">`)
 * by a path relative to the PACKAGE ROOT — the same key
 * `pkgcheck.Package.Assets`/`published_assets.path` stores it under on the
 * server. Left as-is, the browser resolves that path against the SPA's own
 * document URL (`/c/<course>/<chapter>`), not the package — and since
 * `apps/web`'s `_redirects` answers every unknown path with
 * `/index.html 200` (the SPA fallback, deliberately — see
 * `docs/deploy.md` §7), the request "succeeds" with the wrong document
 * instead of failing loudly. `assetUrl(courseId, path)` (`api/catalog.ts`)
 * already builds the correct `/courses/:slug/assets/<path>` URL; this
 * function is the walk that actually calls it, in the same style as
 * `injectExerciseCheckboxes.ts` — a plain function over a container
 * `ChapterView` owns via a ref, run once per chapter render, right after
 * the `innerHTML` write that produces the tree it reads.
 *
 * It was invisible until now only because none of the three shipping
 * courses (`fixtures/courses/*`) contains an `<img>` — see
 * `rewriteAssetUrls.test.ts` and the integration case added to
 * `ChapterView.test.tsx`.
 */

import { assetUrl } from '../api/catalog';

/** Every (selector, attribute) pair this pass rewrites. */
const TARGETS: readonly { selector: string; attr: 'src' | 'href' }[] = [
  { selector: 'img[src]', attr: 'src' },
  { selector: 'source[src]', attr: 'src' },
  { selector: 'a[href]', attr: 'href' },
];

/**
 * Matches any URL that already names an explicit scheme, per RFC 3986's
 * scheme grammar (`ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )`) — this
 * alone covers `http:`, `https:`, `mailto:`, `tel:`, `data:`,
 * `javascript:` and every other absolute reference in one check, since
 * every one of them is "a colon after a leading letter, no `/` before it".
 */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * True when `value` is safe and correct to hand to `assetUrl` — i.e. it
 * names neither an external resource nor something outside the package's
 * own asset space. Format v2 allows a chapter to link or embed an external
 * URL by full address (pkgcheck's content rules block `javascript:` and
 * event-handler attributes, never `http(s):` itself — see
 * `apps/api/internal/pkgcheck/content.go`), so those must be left exactly
 * as authored, not rewritten into a 404 under `/courses/:slug/assets/`.
 *
 * Re-review finding, final whole-branch review: a `".."` path SEGMENT must
 * also be rejected here, not just at the string's start. `assetUrl`
 * (`api/catalog.ts`) percent-encodes each segment with `encodeURIComponent`,
 * which leaves `".."` completely unchanged (dots are unreserved), so
 * `<img src="../../../admin/courses">` used to survive into
 * `/courses/:slug/assets/../../../admin/courses` — a path the BROWSER
 * normalizes before ever sending the request, landing the actual fetch on
 * `/admin/courses` (a real, admin-gated route) instead. This runs on the
 * main chapter DOM, outside the widget sandbox, so that fetch carries the
 * reader's session cookie. Checked by SEGMENT equality, matching
 * `pkgcheck.escapesPackage`'s own precedent for the identical question
 * about package entry names (`apps/api/internal/pkgcheck/pkgcheck.go`) —
 * not a substring match, so an unusual but harmless filename like
 * `..foo.png` (one segment, not equal to `".."`) is not falsely rejected.
 *
 * A bare `"."` segment is deliberately NOT rejected, for the same reason
 * `escapesPackage` does not reject it either: `.` cannot move the
 * resolved path outside `/courses/:slug/assets/` the way `..` can — at
 * worst `./images/fig1.png` becomes a URL the browser normalizes back to
 * `images/fig1.png` under the same prefix, or (if written some other way)
 * a 404 against a `published_assets.path` key that legitimately does not
 * exist, which is an authoring mistake, not a security boundary.
 */
function isPackageRelative(value: string): boolean {
  if (value === '') return false;
  if (value.startsWith('#')) return false; // in-page cross-reference
  if (value.startsWith('//')) return false; // protocol-relative
  if (value.startsWith('/')) return false; // origin-absolute (e.g. the SPA's own /favicon.svg) — never a valid package path; pkgcheck's escapesPackage rejects a leading "/"
  if (SCHEME_RE.test(value)) return false; // http:, https:, mailto:, tel:, data:, javascript:, ...
  if (value.split('/').some((segment) => segment === '..')) return false; // path traversal — see this function's own doc comment
  return true;
}

/**
 * Walks every `img[src]`, `source[src]` and `a[href]` under `root` and
 * rewrites the package-relative ones through `assetUrl(courseId, path)`.
 * Anything `isPackageRelative` rejects — an absolute URL, a
 * protocol-relative URL, an origin-absolute path, a `#fragment` link, a
 * `mailto:`/`tel:`/`data:` URI — is left byte-for-byte as authored.
 *
 * Idempotent: a value this function has already rewritten is an absolute
 * `/courses/...` path, which `isPackageRelative` rejects (leading `/`), so
 * calling it twice on the same tree is a safe no-op on the second pass.
 */
export function rewriteAssetUrls(root: ParentNode, courseId: string): void {
  for (const { selector, attr } of TARGETS) {
    const elements = Array.from(root.querySelectorAll<HTMLElement>(selector));
    for (const el of elements) {
      const value = el.getAttribute(attr);
      if (value === null || !isPackageRelative(value)) continue;
      el.setAttribute(attr, assetUrl(courseId, value));
      // `crossorigin="use-credentials"` — nếu không, ảnh của một khoá RIÊNG
      // hỏng ngay cả với người đã được cấp quyền.
      //
      // Khác với `fetch`, đây là request do TRÌNH DUYỆT tự phát khi nó gặp
      // `<img src>`, và ảnh cross-origin mặc định KHÔNG mang cookie. Không có
      // thuộc tính này thì chữ trong chương hiện ra còn hình thì 404 — một
      // kiểu hỏng nửa vời khó đoán hơn hẳn hỏng cả trang.
      //
      // Đặt cho MỌI khoá, kể cả công khai, và điều đó an toàn: máy chủ trả
      // `Access-Control-Allow-Credentials: true` với một Origin cụ thể, đúng
      // cặp mà `use-credentials` đòi. Đặt có điều kiện theo "khoá này có
      // riêng tư không" sẽ cần trình đọc biết một điều nó không cần biết, và
      // sẽ sai đúng lúc một khoá đổi trạng thái.
      el.setAttribute('crossorigin', 'use-credentials');
    }
  }
}
