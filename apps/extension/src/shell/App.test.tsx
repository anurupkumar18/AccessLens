// @vitest-environment jsdom
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, afterEach } from 'vitest';
import { App } from './App';
import { InMemorySessionClient } from '../shared/contracts';

describe('App shell', () => {
  let container: HTMLDivElement | null = null;

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
});
