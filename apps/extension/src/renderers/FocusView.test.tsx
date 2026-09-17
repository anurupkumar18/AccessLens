// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { AccessPackSchema } from '../shared/contracts';
import { validPack } from '../shared/fixtures';
import { FocusView, WHOLE_SLIDE_NOTE } from './FocusView';
import reviewedBioPack from '../../../../packages/access-packs/bio-cell-demo/pack.json';

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
    const pack = AccessPackSchema.parse(reviewedBioPack);
    const asset = pack.assets[1];
    const region = asset.regions[0];
    render(<FocusView pack={pack} assetId={asset.assetId} regionId={region.regionId} />);

    const img = container!.querySelector<HTMLImageElement>('img.slide-image')!;
    expect(img.src).toMatch(/cell-slide-02.*\.png$/);
    expect(img.alt).toBe(asset.title);

    const highlight = container!.querySelector<HTMLElement>('.region-highlight')!;
    expect(highlight.style.left).toBe(`${region.bounds.x * 100}%`);
    expect(highlight.style.top).toBe(`${region.bounds.y * 100}%`);
    expect(highlight.style.width).toBe(`${region.bounds.width * 100}%`);
    expect(highlight.style.height).toBe(`${region.bounds.height * 100}%`);
    // Bounds are fractions of the image, so the outline's positioned box holds the image and not the caption.
    expect(highlight.parentElement).toBe(img.parentElement);
    expect(highlight.parentElement!.querySelector('figcaption')).toBeNull();

    expect(container!.textContent).toContain(region.plainLanguage);
    expect(container!.querySelector('.cell-membrane')).toBeNull();
  });

  it('marks the region with a pointer outside its outline, only when the reviewed event includes one', () => {
    const pack = AccessPackSchema.parse(reviewedBioPack);
    const asset = pack.assets[1];
    const region = asset.regions[0];
    render(<FocusView pack={pack} assetId={asset.assetId} regionId={region.regionId} pointer={{ x: 0.42, y: 0.31 }} />);
    // At the region's top-left corner, so it never covers what it points at.
    const pointer = container!.querySelector<SVGElement>('.focus-pointer')!;
    expect(pointer.classList.contains('start')).toBe(true);
    expect(pointer.style.left).toBe(`${region.bounds.x * 100}%`);
    expect(pointer.style.top).toBe(`${region.bounds.y * 100}%`);

    act(() => root!.unmount());
    render(<FocusView pack={pack} assetId={asset.assetId} regionId={region.regionId} />);
    expect(container!.querySelector('.focus-pointer')).toBeNull();
  });

  it('puts the reviewed description in the figure caption, where reading commands reach it, and nowhere hidden', () => {
    const pack = AccessPackSchema.parse(reviewedBioPack);
    const asset = pack.assets[1];
    const region = asset.regions[0];
    render(<FocusView pack={pack} assetId={asset.assetId} regionId={region.regionId} />);
    const figure = container!.querySelector('figure')!;
    expect(figure.getAttribute('aria-label')).toBeNull();
    expect(figure.querySelector('figcaption')!.textContent).toBe(region.shortDescription);
    // Said once: the caption is the only place the short description appears.
    expect(container!.textContent!.split(region.shortDescription).length - 1).toBe(1);
  });

  it('uses the region label as the heading when the pack provides one, else the id', () => {
    const labelled = { ...validPack, assets: [{ ...validPack.assets[0], regions: [{ ...validPack.assets[0].regions[0], label: 'Mitochondrion' }] }] };
    render(<FocusView pack={labelled} assetId="cell-slide-03" regionId="mitochondrion" />);
    expect(container!.querySelector('h3')!.textContent).toBe('Mitochondrion');

    act(() => root!.unmount());
    render(<FocusView pack={validPack} assetId="cell-slide-03" regionId="mitochondrion" />);
    expect(container!.querySelector('h3')!.textContent).toBe('mitochondrion');
  });

  it('shows the whole slide with no outline until the instructor points at a region', () => {
    const pack = AccessPackSchema.parse(reviewedBioPack);
    const asset = pack.assets[1];
    render(<FocusView pack={pack} assetId={asset.assetId} />);
    expect(container!.querySelector<HTMLImageElement>('img.slide-image')!.src).toMatch(/cell-slide-02.*\.png$/);
    expect(container!.querySelector('.region-highlight')).toBeNull();
    expect(container!.querySelector('h3')!.textContent).toBe('Whole slide');
    expect(container!.querySelector('figcaption')!.textContent).toBe(WHOLE_SLIDE_NOTE);
    // Not the first region the pack lists: nothing is claimed until the instructor points.
    expect(container!.textContent).not.toContain(asset.regions[0].shortDescription);
  });

  it('never outlines a different region when the named one is not on this slide', () => {
    const pack = AccessPackSchema.parse(reviewedBioPack);
    render(<FocusView pack={pack} assetId={pack.assets[1].assetId} regionId="not-on-this-slide" />);
    expect(container!.querySelector('.region-highlight')).toBeNull();
    expect(container!.querySelector('h3')!.textContent).toBe('Whole slide');
  });

  it('says the same in text when the pack ships no slide image and no region is followed', () => {
    render(<FocusView pack={validPack} assetId="cell-slide-03" />);
    expect(container!.querySelector('img')).toBeNull();
    expect(container!.textContent).toContain(WHOLE_SLIDE_NOTE);
  });

  it('falls back to text only when the pack ships no slide image', () => {
    render(<FocusView pack={validPack} assetId="cell-slide-03" regionId="mitochondrion" />);
    expect(container!.querySelector('img')).toBeNull();
    expect(container!.querySelector('.region-highlight')).toBeNull();
    expect(container!.textContent).toContain('This structure helps power the cell.');
  });
});
