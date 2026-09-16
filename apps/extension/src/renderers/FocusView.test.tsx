// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { AccessPackSchema } from '../shared/contracts';
import { validPack } from '../shared/fixtures';
import { FocusView } from './FocusView';
import hnswDraftPack from '../../../../packs/hnsw/pack.draft.json';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render(element: React.ReactElement): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(element));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe('FocusView', () => {
  it('shows the slide image and highlights the followed region where the pack says it is', () => {
    const pack = AccessPackSchema.parse(hnswDraftPack);
    const asset = pack.assets[1];
    const region = asset.regions[0];
    render(<FocusView pack={pack} assetId={asset.assetId} regionId={region.regionId} />);

    const img = container!.querySelector<HTMLImageElement>('img.slide-image')!;
    expect(img.src).toMatch(/slide-02.*\.png$/);
    expect(img.alt).toBe(asset.title);

    const highlight = container!.querySelector<HTMLElement>('.region-highlight')!;
    expect(highlight.style.left).toBe(`${region.bounds.x * 100}%`);
    expect(highlight.style.top).toBe(`${region.bounds.y * 100}%`);
    expect(highlight.style.width).toBe(`${region.bounds.width * 100}%`);
    expect(highlight.style.height).toBe(`${region.bounds.height * 100}%`);

    expect(container!.textContent).toContain(region.plainLanguage);
    expect(container!.querySelector('.cell-membrane')).toBeNull();
  });

  it('uses the region label as the heading when the pack provides one, else the id', () => {
    const labelled = { ...validPack, assets: [{ ...validPack.assets[0], regions: [{ ...validPack.assets[0].regions[0], label: 'Mitochondrion' }] }] };
    render(<FocusView pack={labelled} assetId="cell-slide-03" regionId="mitochondrion" />);
    expect(container!.querySelector('h3')!.textContent).toBe('Mitochondrion');

    act(() => root!.unmount());
    render(<FocusView pack={validPack} assetId="cell-slide-03" regionId="mitochondrion" />);
    expect(container!.querySelector('h3')!.textContent).toBe('mitochondrion');
  });

  it('falls back to text only when the pack ships no slide image', () => {
    render(<FocusView pack={validPack} assetId="cell-slide-03" regionId="mitochondrion" />);
    expect(container!.querySelector('img')).toBeNull();
    expect(container!.querySelector('.region-highlight')).toBeNull();
    expect(container!.textContent).toContain('This structure helps power the cell.');
  });
});
