// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { WaterLevelArView } from './WaterLevelArView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('WaterLevelArView', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it('announces the synchronized fluid region and exposes equivalent controls', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<WaterLevelArView regionId="extracellular-fluid" hotspotId="water-level-extracellular" reducedMotion />));

    expect(container.textContent).toContain('Fluid between cells - 14 liters');
    expect(container.textContent).toContain('Water outside cells');
    expect(container.textContent).toContain('WebGL is unavailable');
    expect(container.querySelectorAll('.semantic-hotspots button')).toHaveLength(3);
    expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toBe('Fluid between cells');
  });

  it('lets a keyboard-equivalent control inspect fluid inside cells', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<WaterLevelArView regionId="extracellular-fluid" reducedMotion />));
    const intracellular = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Fluid inside cells');
    await act(async () => intracellular?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toBe('Fluid inside cells');
    expect(container.textContent).toContain('Water held inside cells');
  });
});
