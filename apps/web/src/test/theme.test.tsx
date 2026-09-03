import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

const STORAGE_KEY = 'itbook-theme';

describe('theme toggle', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    delete window.CourseKit;
    /**
     * `/courses`, KHÔNG phải `/`. Từ 03/09/2026 `/` không dựng thanh trên cho
     * một người chưa đăng nhập (`App.tsx`: `authScreen`) — landing mang nhãn
     * hiệu và hai điều khiển thiết bị của chính nó, viết bằng phấn. `#theme-btn`
     * là nút của THANH TRÊN, nên hai bài dưới phải đứng ở một route công khai
     * còn thanh trên. Bản thân nút phấn của landing có bộ test riêng
     * (`pages/Landing.test.tsx`).
     */
    window.history.pushState({}, '', '/courses');
  });

  it('defaults to light when nothing is stored', () => {
    render(<App />);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('reads a persisted theme from localStorage on mount', () => {
    window.localStorage.setItem(STORAGE_KEY, 'dark');
    render(<App />);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('flips data-theme and persists to localStorage on toggle, and back again', async () => {
    const user = userEvent.setup();
    render(<App />);
    const themeBtn = document.getElementById('theme-btn')!;

    await user.click(themeBtn);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('dark');

    await user.click(themeBtn);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('light');
  });

  it('invokes every CourseKit redraw after toggle, and survives one throwing', async () => {
    const throwingRedraw = vi.fn(() => {
      throw new Error('boom');
    });
    const okRedraw = vi.fn();
    window.CourseKit = {
      initViz: vi.fn(),
      renderKatex: vi.fn(),
      REDRAWS: [throwingRedraw, okRedraw],
      VIZ: {},
    };

    const user = userEvent.setup();
    render(<App />);
    await user.click(document.getElementById('theme-btn')!);

    expect(throwingRedraw).toHaveBeenCalledTimes(1);
    expect(okRedraw).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
