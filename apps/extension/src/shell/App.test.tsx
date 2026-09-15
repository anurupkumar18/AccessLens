// @vitest-environment jsdom
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { App } from './App';
import { InMemorySessionClient } from '../shared/contracts';
import { loadPreferences, resetPreferencesForTests } from '../shared/preferences';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('App shell', () => {
  let container: HTMLDivElement | null = null;

  beforeEach(() => resetPreferencesForTests());

  afterEach(() => {
    if (container) {
      container.remove();
      container = null;
    }
  });

  it('lets the student view follow a fixture event sent from the instructor view, with no network client', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const client = new InMemorySessionClient();
    const root = createRoot(container);
    act(() => root.render(<App client={client} />));

    const sendButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Send fixture event')!;
    act(() => sendButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const studentButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Student')!;
    act(() => studentButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(container.textContent).toContain('Following mitochondrion on cell-slide-03');
  });

  it('persists the student reduced-motion preference to local storage only', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const client = new InMemorySessionClient();
    const root = createRoot(container);
    await act(async () => root.render(<App client={client} />));

    const studentButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Student')!;
    act(() => studentButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const toggle = container.querySelector('#reduced-motion-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    await act(async () => toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(toggle.checked).toBe(true);
    expect((await loadPreferences()).reducedMotion).toBe(true);
  });
});
