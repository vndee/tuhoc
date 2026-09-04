import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n/LanguageProvider';
import StoryIndexPage from '../stories/components/StoryIndex';
import { ThemeProvider } from '../theme/ThemeContext';
import { Shell } from './Shell';

describe('Shell', () => {
  it('keeps the fixed skeleton while editorial mode marks the app root', () => {
    render(<Shell sidebar="side" topbar="top" rail="rail" editorialScreen>body</Shell>);

    expect(document.getElementById('app')).toHaveClass('editorial-screen');
    expect(document.querySelector('#app > #main > #scroller > #content-wrap > #content')).toHaveTextContent('body');
    expect(screen.getByText('side').closest('#sidebar')).toBeInTheDocument();
    expect(screen.getByText('top').closest('#topbar')).toBeInTheDocument();
    expect(screen.getByText('rail').closest('#rail')).toBeInTheDocument();
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
