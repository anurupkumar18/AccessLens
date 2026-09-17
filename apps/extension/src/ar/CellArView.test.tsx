// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { CellArView } from './CellArView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('CellArView', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it('announces the synchronized hotspot and always exposes semantic controls', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(
      <CellArView regionId="mitochondrion" hotspotId="mitochondrion-hotspot" reducedMotion={false} />,
    ));

    expect(container.textContent).toContain('Mitochondrion');
    expect(container.textContent).toContain('releases usable energy');
    expect(container.textContent).toContain('WebGL is unavailable');
    expect(container.querySelectorAll('.semantic-hotspots button')).toHaveLength(10);
    expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toBe('Mitochondrion');
  });

  it('lets a keyboard-equivalent control inspect another structure', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(
      <CellArView regionId="mitochondrion" hotspotId="mitochondrion-hotspot" reducedMotion />,
    ));
    const nucleus = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Nucleus');
    await act(async () => nucleus?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toBe('Nucleus');
    expect(container.textContent).toContain('stores genetic instructions');
  });

  it('uses a distinct spatial composition for the protein-shipping slide', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(
      <CellArView assetId="cell-slide-04" regionId="ribosome" hotspotId="ribosome-hotspot" reducedMotion />,
    ));

    expect(container.textContent).toContain('Explore the protein factory');
    expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toBe('Ribosome');
  });
});
