// @vitest-environment jsdom
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function Boom(): React.ReactElement {
  throw new Error('render failed');
}

describe('ErrorBoundary', () => {
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (container) {
      container.remove();
      container = null;
    }
  });

  it('renders children when nothing throws', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<ErrorBoundary><p>All good</p></ErrorBoundary>));
    expect(container.textContent).toContain('All good');
  });

  it('shows an accessible alert instead of crashing when a child throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<ErrorBoundary><Boom /></ErrorBoundary>));
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toMatch(/something went wrong/i);
    spy.mockRestore();
  });
});
