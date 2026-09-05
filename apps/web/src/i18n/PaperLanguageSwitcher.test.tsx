import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from './LanguageProvider';
import { PaperLanguageSwitcher } from './PaperLanguageSwitcher';

function Providers({ children }: { children: ReactNode }) {
  return <LanguageProvider>{children}</LanguageProvider>;
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('lang');
});

describe('<PaperLanguageSwitcher>', () => {
  it('opens a custom menu, changes language, and restores trigger focus', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <PaperLanguageSwitcher />
      </Providers>,
    );
    const trigger = screen.getByRole('button', { name: 'Ngôn ngữ giao diện' });
    expect(trigger).not.toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');

    await user.click(trigger);
    await user.click(screen.getByRole('menuitemradio', { name: /English/i }));

    expect(document.documentElement).toHaveAttribute('lang', 'en');
    expect(trigger).toHaveFocus();
  });

  it('supports ArrowDown, Home, End, Enter, Escape, and click outside', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <PaperLanguageSwitcher />
      </Providers>,
    );
    const trigger = screen.getByRole('button', { name: 'Ngôn ngữ giao diện' });

    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: /Tiếng Việt/i })).toHaveFocus();
    await user.keyboard('{End}{Enter}');
    expect(document.documentElement).toHaveAttribute('lang', 'en');

    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('renders only the active language code in an unboxed trigger without a chevron', () => {
    render(
      <Providers>
        <PaperLanguageSwitcher />
      </Providers>,
    );

    const trigger = screen.getByRole('button', { name: 'Ngôn ngữ giao diện' });
    expect(trigger).toHaveClass('paper-language-trigger');
    expect(trigger).toHaveTextContent(/^VI$/);
    expect(trigger.querySelector('svg')).toBeNull();
    expect(trigger.querySelectorAll('*')).toHaveLength(0);
  });

  it('closes from pointerdown in its owner document and removes that listener when closed or unmounted', async () => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const ownerDocument = iframe.contentDocument;
    if (ownerDocument === null) throw new Error('iframe document is unavailable');
    expect(ownerDocument.defaultView?.Node).not.toBe(Node);

    const addEventListener = vi.spyOn(ownerDocument, 'addEventListener');
    const removeEventListener = vi.spyOn(ownerDocument, 'removeEventListener');
    const view = within(ownerDocument.body);
    const { unmount } = render(
      <Providers>
        <PaperLanguageSwitcher />
      </Providers>,
      { container: ownerDocument.body },
    );

    const trigger = view.getByRole('button', { name: 'Ngôn ngữ giao diện' });
    fireEvent.click(trigger);
    await view.findByRole('menu');
    expect(addEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));

    fireEvent.pointerDown(ownerDocument.body);
    await waitFor(() => expect(view.queryByRole('menu')).not.toBeInTheDocument());
    expect(removeEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));

    fireEvent.click(trigger);
    await view.findByRole('menu');
    unmount();
    expect(removeEventListener).toHaveBeenCalledTimes(2);
    iframe.remove();
  });

  it('defines every local SVG filter it references without duplicating filter IDs', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <PaperLanguageSwitcher />
        <PaperLanguageSwitcher />
      </Providers>,
    );

    const triggers = screen.getAllByRole('button', { name: 'Ngôn ngữ giao diện' });
    await user.click(triggers[0]);
    await user.click(triggers[1]);

    const filters = [...document.querySelectorAll('.paper-language-menu filter[id]')];
    const filterIds = filters.map((filter) => filter.id);
    expect(new Set(filterIds).size).toBe(filterIds.length);

    for (const node of document.querySelectorAll<SVGElement>('.paper-language-menu [filter]')) {
      const reference = node.getAttribute('filter');
      const match = reference?.match(/^url\(#(.+)\)$/);
      expect(match?.[1]).toBeTruthy();
      expect(filters.some((filter) => filter.id === match?.[1])).toBe(true);
    }
  });
});
