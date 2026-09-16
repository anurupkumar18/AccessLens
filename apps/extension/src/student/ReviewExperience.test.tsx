// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validPack } from '../shared/fixtures';
import { defaultPreferences } from '../shared/preferences';
import { ReviewExperience } from './ReviewExperience';
import { resetReviewBookmarksForTests } from './reviewBookmarks';

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

  beforeEach(() => resetReviewBookmarksForTests());
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
});
