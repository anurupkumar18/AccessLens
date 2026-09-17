// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { validPack } from '../shared/fixtures';
import { packOutline, regionName } from '../student/packOutline';
import { StructuredTextView } from './StructuredTextView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
});

describe('Read mode for screen readers', () => {
  const slide = validPack.assets[0];
  const region = slide.regions[0];

  it('is one landmark with a contents list and an article per slide, headings in reading order', () => {
    render(<StructuredTextView pack={validPack} />);
    expect(container!.querySelectorAll('section[aria-labelledby]')).toHaveLength(1);
    expect(container!.querySelector('nav')?.getAttribute('aria-label')).toBe('Slides in this lesson');
    const articles = container!.querySelectorAll('article.read-slide');
    expect(articles).toHaveLength(validPack.assets.length);
    expect(articles[0].querySelector('h4')?.textContent).toBe(slide.title);
    const regionHeadings = Array.from(articles[0].querySelectorAll('h5')).map((h) => h.textContent);
    expect(regionHeadings).toEqual(packOutline(validPack)[0].regions.map(regionName));
    expect(container!.querySelector('[aria-current]')).toBeNull();
    expect(container!.querySelector('.skip-link')).toBeNull();
  });

  it('marks the instructor slide and region and offers a skip link to it', () => {
    render(<StructuredTextView pack={validPack} assetId={slide.assetId} regionId={region.regionId} />);
    const skip = container!.querySelector<HTMLAnchorElement>('.skip-link')!;
    expect(skip.getAttribute('href')).toBe(`#read-title-${slide.assetId}`);
    expect(container!.querySelector(`#read-title-${slide.assetId}`)?.getAttribute('tabindex')).toBe('-1');
    expect(container!.querySelector('article[tabindex]')).toBeNull();
    expect(skip.textContent).toContain(slide.title);
    const article = container!.querySelector(`#read-${slide.assetId}`)!;
    expect(article.getAttribute('aria-current')).toBe('true');
    expect(article.querySelector('h4')?.textContent).toContain('Instructor is on this slide');
    const pointed = container!.querySelector(`#read-${slide.assetId}-${region.regionId}`)!;
    expect(pointed.getAttribute('aria-current')).toBe('true');
    expect(pointed.querySelector('h5')?.textContent).toContain('instructor is pointing here');
    expect(container!.querySelectorAll('article[aria-current="true"]')).toHaveLength(1);
  });

  it('names the plain-language paragraph so it is not read as a repeat', () => {
    render(<StructuredTextView pack={validPack} />);
    const withPlain = validPack.assets.flatMap((a) => a.regions).find((r) => r.plainLanguage !== r.shortDescription);
    if (!withPlain) return;
    const plain = Array.from(container!.querySelectorAll('.read-regions .supporting-text')).find((p) => p.textContent?.includes(withPlain.plainLanguage))!;
    expect(plain.textContent).toMatch(/^In plain language: /);
  });
});
