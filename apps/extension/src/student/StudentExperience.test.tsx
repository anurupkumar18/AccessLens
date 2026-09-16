// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import axe from 'axe-core';
import { InMemorySessionClient } from '../shared/contracts';
import { validEvent, validPack } from '../shared/fixtures';
import { defaultPreferences, type StudentPreferences } from '../shared/preferences';
import { StudentExperience } from './StudentExperience';

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

  function renderExperience(event = validEvent): { preferences: StudentPreferences; rerender(): void } {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const state = { preferences: defaultPreferences };
    const rerender = (): void => {
      root?.render(
        <StudentExperience
          client={new InMemorySessionClient()}
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
