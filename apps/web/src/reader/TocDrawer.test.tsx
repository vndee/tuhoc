/**
 * The reading view's table of contents — the drawer that replaced two
 * columns.
 *
 * `ChapterView.test.tsx` covers the wiring (that the chapter's h2/h3s reach
 * this component at all, and that they are no longer in `#rail`). What is
 * measured HERE is the drawer's own three promises, each of which is a thing
 * a reader or a keyboard notices and no wiring test can see:
 *
 *   1. closed means CLOSED — not merely invisible, but out of the tab order,
 *      because a drawer with forty chapter links still tabbable is a keyboard
 *      trap you cannot see;
 *   2. it holds BOTH lists, so the course outline that used to be the app
 *      sidebar is still reachable from inside a chapter;
 *   3. it gets out of the way by itself — on Escape, and on any navigation,
 *      including a click on the chapter the reader is already in.
 *
 * `vite.config.ts` runs vitest with `css: true`, so `styles/index.css` (and
 * through it `reader-layout.css`) is really applied here. That is what makes
 * claim 1 measurable at all: `visibility: hidden` is a computed style, and
 * Testing Library's role queries honour it exactly as a browser's
 * accessibility tree does.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { Part } from '../course/types';
import { LanguageProvider } from '../i18n/LanguageProvider';
import '../styles/index.css';
import { type DrawerHeading, TocDrawer } from './TocDrawer';

const PARTS: Part[] = [
  {
    title: 'Phần 0 · Nền móng',
    chapters: [
      { id: 'c1', num: '0.1', title: 'Chương một', short: 'Thông tin là gì', file: 'chapters/c1.html' },
      { id: 'c2', num: '0.2', title: 'Chương hai', short: 'Entropy', file: 'chapters/c2.html' },
    ],
  },
  {
    title: 'Phần 1 · Nguồn',
    chapters: [{ id: 'c3', num: '1.1', title: 'Chương ba', short: 'Mã hoá nguồn', file: 'chapters/c3.html' }],
  },
];

const HEADINGS: DrawerHeading[] = [
  { id: 'h-a', text: 'Bài toán truyền tin', level: 2 },
  { id: 'h-b', text: 'Một hệ quả', level: 3 },
];

function PathProbe() {
  const location = useLocation();
  return <span data-testid="path">{location.pathname}</span>;
}

/**
 * The drawer plus the one piece of state its owner holds, so a test can drive
 * it the way `ChapterView` does — through a button that toggles `open`,
 * rather than by re-rendering with a different prop. The difference matters
 * for the focus claims: focus has to have somewhere real to return TO.
 */
function Harness({ initialOpen = false }: { initialOpen?: boolean } = {}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <LanguageProvider>
      <MemoryRouter initialEntries={['/c/demo/c1']}>
        <PathProbe />
        <button type="button" onClick={() => setOpen((v) => !v)}>
          Mục lục
        </button>
        <TocDrawer
          open={open}
          onClose={() => setOpen(false)}
          courseId="demo"
          courseTitle="***REMOVED***"
          currentChapterId="c1"
          parts={PARTS}
          headings={HEADINGS}
          currentHeadingId="h-a"
        />
      </MemoryRouter>
    </LanguageProvider>
  );
}

function opener(): HTMLElement {
  return screen.getByRole('button', { name: 'Mục lục' });
}

describe('TocDrawer', () => {
  it('đóng thì KHÔNG tab tới được, nhưng vẫn nằm trong DOM', async () => {
    render(<Harness />);

    // Out of the accessibility tree and out of the tab order: `getByRole`
    // applies the same `visibility` rule a browser does. If this ever starts
    // finding them, the drawer has become a keyboard trap — forty chapter
    // links a reader can Tab into but cannot see.
    expect(screen.queryByRole('link', { name: /entropy/i })).toBeNull();
    expect(screen.queryByRole('navigation', { name: /mục lục khoá học/i })).toBeNull();

    // Still MOUNTED, and that is load-bearing rather than incidental: the
    // chapter's own outline links are what `ChapterView.test.tsx`'s
    // `settleChapter` uses as its witness that a `setState` fired from inside
    // an effect body has landed in a commit. Unmounting the drawer when
    // closed would take that measurement away, and nothing structural
    // replaces it — see that file's own header.
    expect(document.querySelectorAll('.rd-toc a')).toHaveLength(2);
    expect(document.getElementById('reader-toc-drawer')).not.toBeNull();
    expect(document.getElementById('reader-toc-drawer')).toHaveAttribute('aria-hidden', 'true');
  });

  it('mở ra thì có CẢ HAI mục lục: trong chương, và các chương của khoá', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(opener());

    const drawer = screen.getByRole('navigation', { name: /mục lục khoá học/i });

    // 1. Trong chương — h2/h3 của chương đang đọc, mục đang xem được tô.
    expect(within(drawer).getByRole('link', { name: 'Bài toán truyền tin' })).toHaveClass('cur');
    expect(within(drawer).getByRole('link', { name: 'Một hệ quả' })).toHaveClass('lvl3');

    // 2. Mục lục khoá — thứ TỪNG là thanh bên ứng dụng. Không có nửa này thì
    //    bỏ thanh bên đi là làm cho mọi chương khác không tới được từ trong
    //    một chương, tức một bước lùi về điều hướng đội lốt thiết kế lại.
    expect(within(drawer).getByText('Phần 0 · Nền móng')).toBeInTheDocument();
    expect(within(drawer).getByText('Phần 1 · Nguồn')).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: /mã hoá nguồn/i })).toHaveAttribute('href', '/c/demo/c3');

    // 3. "Bạn đang ở đây" — một mục lục mở ra từ trong một chương mà không
    //    nói được chương nào là mục lục bị xé mất phần quan trọng nhất. Cả
    //    lớp (reader.css vẽ `.active`) lẫn `aria-current` (màu không phải
    //    một lời thông báo).
    const here = within(drawer).getByRole('link', { name: /thông tin là gì/i });
    expect(here).toHaveClass('active');
    expect(here).toHaveAttribute('aria-current', 'page');
    expect(within(drawer).getByRole('link', { name: /entropy/i })).not.toHaveAttribute('aria-current');
  });

  it('Escape đóng nó, và chỉ khi nó đang mở', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // Với ngăn kéo đang ĐÓNG, Escape không được nuốt: cùng phím ấy là đường
    // ra của panel hỏi–đáp và của tấm ghi chú, và một listener luôn bật sẽ
    // cướp mất của cả hai. Không có gì để khẳng định trực tiếp ở đây ngoài
    // "nó vẫn đóng", nên khẳng định đúng nằm ở nửa sau: nó đóng được sau khi
    // MỞ, tức listener chỉ tồn tại đúng lúc nó nên tồn tại.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('navigation', { name: /mục lục khoá học/i })).toBeNull();

    await user.click(opener());
    expect(screen.getByRole('navigation', { name: /mục lục khoá học/i })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('navigation', { name: /mục lục khoá học/i })).toBeNull());
  });

  it('tiêu điểm vào ngăn kéo khi mở, và TRẢ VỀ chỗ cũ khi đóng', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    opener().focus();
    await user.click(opener());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /đóng mục lục/i }));

    await user.keyboard('{Escape}');
    // Không có nửa này, đóng ngăn kéo để tiêu điểm nằm trên một nút
    // `visibility:hidden`, và cú Tab kế tiếp bắt đầu lại từ đầu tài liệu.
    await waitFor(() => expect(document.activeElement).toBe(opener()));
  });

  it('bấm một chương thì ngăn kéo đóng — kể cả chương đang đọc', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(opener());
    await user.click(screen.getByRole('link', { name: /entropy/i }));
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/c/demo/c2'));
    expect(screen.queryByRole('navigation', { name: /mục lục khoá học/i })).toBeNull();

    // Và trường hợp một `onClick` trên mỗi liên kết vẫn bắt được nhưng một
    // effect chỉ nghe `pathname` thì KHÔNG: bấm đúng chương mình đang đọc.
    // React Router đẩy một mục lịch sử mới với cùng `pathname` và một `key`
    // mới; thiếu `key` trong deps thì ngăn kéo ở lại, che đúng đoạn chữ nó
    // vừa được nhờ chỉ đường tới.
    await user.click(opener());
    expect(screen.getByRole('navigation', { name: /mục lục khoá học/i })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: /entropy/i }));
    await waitFor(() => expect(screen.queryByRole('navigation', { name: /mục lục khoá học/i })).toBeNull());
  });

  it('khoá chưa có chương nào thì nói ra, chứ không hiện một ngăn kéo trống', async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/c/demo/c1']}>
          <button type="button" onClick={() => undefined}>
            Mục lục
          </button>
          <TocDrawer
            open
            onClose={() => undefined}
            courseId="demo"
            courseTitle="Khoá rỗng"
            currentChapterId="c1"
            parts={[]}
            headings={[]}
            currentHeadingId={null}
          />
        </MemoryRouter>
      </LanguageProvider>,
    );

    const drawer = screen.getByRole('navigation', { name: /mục lục khoá học/i });
    expect(within(drawer).getByText(/chưa có chương nào/i)).toBeInTheDocument();
    expect(within(drawer).getByText(/không có mục con/i)).toBeInTheDocument();
    expect(within(drawer).queryAllByRole('link')).toHaveLength(0);
    await user.keyboard('{Escape}');
  });
});
