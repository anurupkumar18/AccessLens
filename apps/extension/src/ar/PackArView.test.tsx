// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { validPack } from '../shared/fixtures';
import { PackArView } from './PackArView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('PackArView', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it('renders the shared asset regions instead of a fixed cell scene', async () => {
    const asset = validPack.assets[0];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<PackArView asset={asset} regionId={asset.regions[0].regionId} reducedMotion />));

    expect(container.textContent).toContain(asset.title);
    expect(container.textContent).toContain(asset.regions[0].shortDescription);
    expect(container.querySelectorAll('.semantic-hotspots button')).toHaveLength(asset.regions.length);
    expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toBe(asset.regions[0].label ?? asset.regions[0].regionId);
  });

  it('does not invent a scene when the slide is unmatched', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<PackArView reducedMotion />));

    expect(container.textContent).toContain('slide is unmatched');
    expect(container.querySelector('.semantic-hotspots')).toBeNull();
  });
});
