// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validPack } from '../shared/fixtures';
import { defaultPreferences } from '../shared/preferences';
import { ReviewExperience } from './ReviewExperience';
import { resetReviewBookmarksForTests } from './reviewBookmarks';
import { resetReviewProgressForTests } from './reviewProgress';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const multiConceptPack = {
  ...validPack,
  assets: [
    ...validPack.assets,
    { ...validPack.assets[0], assetId: 'review-second-asset', title: 'Second reviewed concept' },
  ],
};

describe('ReviewExperience', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => { resetReviewBookmarksForTests(); resetReviewProgressForTests(); });
  afterEach(() => { act(() => root?.unmount()); container?.remove(); root = null; container = null; });

  function render(pack = validPack): void {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<ReviewExperience pack={pack} preferences={defaultPreferences} />));
  }

  it('is visibly self-paced and not a live class history', () => {
    render();
    expect(container!.textContent).toContain('Review mode');
    expect(container!.textContent).toContain('Not live. This page uses reviewed pack content');
    expect(container!.textContent).toContain('Concept 1 of');
  });

  it('steps through reviewed concepts and saves a local bookmark', async () => {
    render(multiConceptPack);
    const before = container!.textContent;
    const next = Array.from(container!.querySelectorAll('button')).find((button) => button.textContent === 'Next concept')!;
    await act(async () => next.click());
    expect(container!.textContent).not.toBe(before);

    const bookmark = Array.from(container!.querySelectorAll('button')).find((button) => button.textContent === 'Bookmark for later')!;
    await act(async () => bookmark.click());
    expect(bookmark.getAttribute('aria-pressed')).toBe('true');
    expect(container!.textContent).toContain('1 local bookmark in this pack.');
  });

  it('records only an explicit private explored mark', async () => {
    render(multiConceptPack);
    expect(container!.textContent).toContain('0 of 2 concepts marked explored on this device. This is private and not a grade.');
    const mark = Array.from(container!.querySelectorAll('button')).find((button) => button.textContent === 'Mark explored')!;
    await act(async () => mark.click());
    const marked = Array.from(container!.querySelectorAll('button')).find((button) => button.textContent === 'Mark not explored')!;
    expect(marked.getAttribute('aria-pressed')).toBe('true');
    expect(container!.textContent).toContain('1 of 2 concepts marked explored on this device. This is private and not a grade.');
  });

  it('moves review format tabs with Arrow keys, Home, and End', async () => {
    render();
    const tab = (name: string) => Array.from(container!.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent === name)!;
    await act(async () => tab('Read').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(tab('Hear').getAttribute('aria-selected')).toBe('true');
    await act(async () => tab('Hear').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    expect(tab('Focus').getAttribute('aria-selected')).toBe('true');
    await act(async () => tab('Focus').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    expect(tab('Hear').getAttribute('aria-selected')).toBe('true');
    expect(container!.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe('review-mode-tab-hear');
  });
});
