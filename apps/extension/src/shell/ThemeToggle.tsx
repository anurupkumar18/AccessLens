import React, { useEffect, useState } from 'react';
import { readChoice, writeChoice } from './localChoice';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'accesslens-theme';

function systemTheme(): Theme {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Switches between light and dark. Until the viewer clicks it, the page follows
 * the system setting; a click pins the other theme on <html data-theme> and
 * remembers it on this device only.
 */
export function ThemeToggle(): React.ReactElement {
  const [pinned, setPinned] = useState<Theme | null>(() => readChoice(STORAGE_KEY, ['light', 'dark'] as const));
  const [system, setSystem] = useState<Theme>(systemTheme);
  const theme = pinned ?? system;

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystem(query.matches ? 'dark' : 'light');
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    if (pinned) document.documentElement.dataset.theme = pinned;
    else delete document.documentElement.dataset.theme;
  }, [pinned]);

  function toggle(): void {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setPinned(next);
    writeChoice(STORAGE_KEY, next);
  }

  return (
    <button type="button" className="theme-toggle" onClick={toggle}>
      {theme === 'dark' ? 'Light mode' : 'Dark mode'}
    </button>
  );
}
