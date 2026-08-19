import { createContext, useContext, type ReactNode } from 'react';
import { useTheme, type Theme } from './useTheme';

export interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * The SINGLE owner of `useTheme()`'s state for the whole app. This exists
 * because of a debt carried from Task 11: the reader's `t`/`T` keyboard
 * shortcut (v1 parity — `***REMOVED***.html:11170`) needs to call
 * the exact same `toggle` that drives `#theme-btn`'s icon in the topbar.
 * `theme` is React state owned by `AppShell` (`App.tsx`) — a second,
 * independent `useTheme()` call inside `ChapterView` would create its OWN
 * `theme` state, and while both instances would still write the same
 * `<html data-theme>`/localStorage, `AppShell`'s copy of `theme` (the one
 * `#theme-btn`'s icon is rendered from) would silently desync from
 * whichever instance last toggled — e.g. pressing `t` in the reader would
 * flip the page's actual theme but leave the topbar showing the OLD
 * icon until something re-renders `AppShell` for an unrelated reason.
 *
 * The fix is this Context: `useTheme()` is called exactly ONCE, here, and
 * every consumer — `AppShell` (for `#theme-btn`'s props) and `ChapterView`
 * (for the `t`/`T` shortcut) — reads the SAME `{theme, toggle}` via
 * `useThemeContext()` instead of calling the hook a second time.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const value = useTheme();
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Throws outside `<ThemeProvider>` rather than silently returning a default — a reader keyboard shortcut wired without the provider is a bug to surface loudly, not paper over. */
export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) {
    throw new Error('useThemeContext() must be used within <ThemeProvider>');
  }
  return ctx;
}
