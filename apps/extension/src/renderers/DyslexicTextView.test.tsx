// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DyslexicTextView } from './DyslexicTextView';
import { validPack } from '../shared/fixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('DyslexicTextView', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it('uses the reviewed live text and exposes a local style toggle', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<DyslexicTextView pack={validPack} assetId="cell-slide-03" regionId="mitochondrion" />));
    expect(container.querySelector('.dyslexic-view--enabled')).not.toBeNull();
    expect(container.textContent).toContain('This structure helps power the cell.');
    const toggle = container.querySelector('button') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    act(() => toggle.click());
    expect(container.querySelector('.dyslexic-view--enabled')).toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });
});
