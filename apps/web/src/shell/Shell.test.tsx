import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n/LanguageProvider';
import StoryIndexPage from '../stories/components/StoryIndex';
import { ThemeProvider } from '../theme/ThemeContext';
import { Shell } from './Shell';

describe('Shell', () => {
  it('keeps the fixed skeleton while editorial mode marks the app root', () => {
    // Bọc như ỨNG DỤNG bọc, không dựng trần. `Shell` nay dựng `<Footer>`, mà
    // chân trang cần ngôn ngữ (`useLanguage`) và router (`<Link>`) — App.tsx
    // luôn cho nó cả hai. Một bài test dựng Shell theo cách ứng dụng không bao
    // giờ dựng thì đo một hình dạng không tồn tại.
    render(
      <LanguageProvider><MemoryRouter>
        <Shell sidebar="side" topbar="top" rail="rail" editorialScreen>body</Shell>
      </MemoryRouter></LanguageProvider>,
    );

    expect(document.getElementById('app')).toHaveClass('editorial-screen');
    expect(document.querySelector('#app > #main > #scroller > #content-wrap > #content')).toHaveTextContent('body');
    expect(screen.getByText('side').closest('#sidebar')).toBeInTheDocument();
    expect(screen.getByText('top').closest('#topbar')).toBeInTheDocument();
    expect(screen.getByText('rail').closest('#rail')).toBeInTheDocument();

    // Chân trang nằm TRONG `#scroller` và SAU `#content-wrap` — không phải
    // trong `<main>` (sẽ bị bó vào cột nội dung) và không phải ngoài
    // `#scroller` (sẽ dính đáy khung nhìn).
    expect(document.querySelector('#app > #main > #scroller > #site-footer')).toBeInTheDocument();
  });

  it('KHÔNG dựng chân trang trên màn hình trước-tài-khoản', () => {
    // Landing và Login tự mang lối vào hai trang pháp lý trong bố cục riêng;
    // thêm một dải nữa ở dưới là hai chân trang chồng nhau.
    render(
      <LanguageProvider><MemoryRouter>
        <Shell sidebar={null} topbar={null} authScreen>body</Shell>
      </MemoryRouter></LanguageProvider>,
    );

    expect(document.getElementById('site-footer')).not.toBeInTheDocument();
  });

  it('keeps a single main landmark when the editorial collection runs in Shell', () => {
    render(
      <ThemeProvider><LanguageProvider><MemoryRouter>
        <Shell sidebar={null} topbar={null} editorialScreen><StoryIndexPage /></Shell>
      </MemoryRouter></LanguageProvider></ThemeProvider>,
    );

    expect(screen.getAllByRole('main')).toHaveLength(1);
  });
});
