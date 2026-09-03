import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../App';

describe('App shell', () => {
  it('renders the full v1 DOM skeleton so reader.css applies unmodified', () => {
    render(<App />);

    // #app > #sidebar + #main(#topbar, #progwrap > #progbar,
    //                          #scroller > #content-wrap > #content + #rail)
    expect(document.querySelector('#app')).toBeInTheDocument();
    expect(document.querySelector('#app > #sidebar')).toBeInTheDocument();
    expect(document.querySelector('#app > #main')).toBeInTheDocument();
    expect(document.querySelector('#main > #topbar')).toBeInTheDocument();
    expect(document.querySelector('#main > #progwrap > #progbar')).toBeInTheDocument();
    expect(document.querySelector('#main > #scroller > #content-wrap > #content')).toBeInTheDocument();
    expect(document.querySelector('#main > #scroller > #content-wrap > #rail')).toBeInTheDocument();
  });

  it('renders the topbar button ids reader.css and later tasks depend on', () => {
    // `/courses` chứ không phải `/`: `/` cho khách chưa đăng nhập là landing,
    // và landing KHÔNG có thanh trên (`App.tsx`: `authScreen`). Các id dưới đây
    // thuộc về thanh trên, nên bài này phải đứng ở một route còn dựng nó.
    window.history.pushState({}, '', '/courses');
    render(<App />);
    for (const id of ['menu-btn', 'crumb', 'mark-btn', 'theme-btn', 'prev-btn', 'next-btn']) {
      expect(document.getElementById(id)).toBeInTheDocument();
    }
  });
});
