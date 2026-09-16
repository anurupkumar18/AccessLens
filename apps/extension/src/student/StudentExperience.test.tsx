// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { InMemorySessionClient, type SessionClient } from '../shared/contracts';
import { validEvent, validPack } from '../shared/fixtures';
import { defaultPreferences, type StudentPreferences } from '../shared/preferences';
import { StudentExperience } from './StudentExperience';

class FakeConnectionAwareClient extends InMemorySessionClient {
  private connectionListeners = new Set<(connected: boolean) => void>();
  onConnectionChange(listener: (connected: boolean) => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }
  emitConnectionChange(connected: boolean): void {
    this.connectionListeners.forEach((listener) => listener(connected));
  }
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('StudentExperience', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function renderExperience(event = validEvent, client: SessionClient = new InMemorySessionClient()): { preferences: StudentPreferences; rerender(): void } {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const state = { preferences: defaultPreferences };
    const rerender = (): void => {
      root?.render(
        <StudentExperience
          client={client}
          event={event}
          pack={validPack}
          preferences={state.preferences}
          onPreferencesChange={(next) => { state.preferences = next; rerender(); }}
        />,
      );
    };
    act(rerender);
    return { get preferences() { return state.preferences; }, rerender };
  }

  it('follows an instructor event and renders Focus mode first', () => {
    renderExperience();
    expect(container?.textContent).toContain('Following mitochondrion on cell-slide-03.');
    expect(container?.textContent).toContain('Focus view');
  });

  it('renders capture stopped as a non-live state', () => {
    const stoppedEvent = {
      schemaVersion: '1.0' as const,
      type: 'capture.stopped' as const,
      sessionId: 'demo-session',
      packId: 'bio-cell-demo',
      packVersion: 1,
      sequence: 2,
      sentAt: '2026-09-15T15:00:01Z',
    };
    renderExperience(stoppedEvent);
    expect(container?.querySelector('.connection-pill')?.textContent).toBe('stopped');
    expect(container?.textContent).toContain('Instructor stopped sharing. Showing the last reviewed moment.');
  });

  it('switches to AR through the accessible mode tabs', async () => {
    const harness = renderExperience();
    const arTab = Array.from(container!.querySelectorAll('[role="tab"]')).find((tab) => tab.textContent === 'AR') as HTMLButtonElement;
    await act(async () => {
      arTab.click();
      await import('../ar/CellArView');
    });
    expect(harness.preferences.mode).toBe('ar');
    expect(container?.textContent).toContain('Synchronized AR');
    expect(container?.textContent).toContain('Mitochondrion');
  });

  it('supports arrow-key movement between mode tabs', async () => {
    const harness = renderExperience();
    const focusTab = container!.querySelector('#mode-tab-focus') as HTMLButtonElement;
    await act(async () => focusTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(harness.preferences.mode).toBe('structured-text');
    expect(container?.textContent).toContain('Structured text');
  });

  it('goes stale only on a real disconnect, and live again on reconnect -- not from content silence', async () => {
    const client = new FakeConnectionAwareClient();
    renderExperience(validEvent, client);
    expect(container?.querySelector('.connection-pill')?.textContent).toBe('live');

    await act(async () => client.emitConnectionChange(false));
    expect(container?.querySelector('.connection-pill')?.textContent).toBe('stale');
    expect(container?.textContent).toContain('Connection interrupted. Showing the last reviewed state.');

    await act(async () => client.emitConnectionChange(true));
    expect(container?.querySelector('.connection-pill')?.textContent).toBe('live');
    expect(container?.textContent).toContain('Reconnected.');
  });

  it('stays live when content is quiet, for a transport with no connection status to report', async () => {
    vi.useFakeTimers();
    try {
      renderExperience();
      expect(container?.querySelector('.connection-pill')?.textContent).toBe('live');
      await act(async () => { vi.advanceTimersByTime(120_000); });
      expect(container?.querySelector('.connection-pill')?.textContent).toBe('live');
    } finally {
      vi.useRealTimers();
    }
  });

  it('has no automatically detectable accessibility violations in the AR fallback', async () => {
    renderExperience();
    const arTab = container!.querySelector('#mode-tab-ar') as HTMLButtonElement;
    await act(async () => {
      arTab.click();
      await import('../ar/CellArView');
    });
    const result = await axe.run(container!, {
      rules: {
        region: { enabled: false },
        'color-contrast': { enabled: false },
      },
    });
    expect(result.violations).toEqual([]);
  });
});
