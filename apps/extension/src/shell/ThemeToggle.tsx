import React, { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'accesslens-theme';

/** A theme the viewer pinned earlier, or null to follow the system. Storage can
 *  be unavailable or throw (private windows, blocked site data). */
function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Switches between light and dark. Until the viewer clicks it, the page follows
 * the system setting; a click pins the other theme on <html data-theme> and
 * remembers it on this device only.
 */
export function ThemeToggle(): React.ReactElement {
  const [pinned, setPinned] = useState<Theme | null>(storedTheme);
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
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* remembered for this page only */ }
  }

  return (
    <button type="button" className="theme-toggle" onClick={toggle}>
      {theme === 'dark' ? 'Light mode' : 'Dark mode'}
    </button>
  );
}
