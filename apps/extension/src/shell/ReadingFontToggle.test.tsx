// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { ReadingFontToggle } from './ReadingFontToggle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render(): HTMLButtonElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<ReadingFontToggle />));
  return container.querySelector('button')!;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = root = null;
  window.localStorage.clear();
  delete document.documentElement.dataset.reading;
});

describe('ReadingFontToggle', () => {
  it('starts off, as a labelled toggle button', () => {
    const button = render();
    expect(button.textContent).toBe('Dyslexia-friendly text');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(document.documentElement.dataset.reading).toBeUndefined();
  });

  it('switches the whole page to the dyslexia-friendly font and back', () => {
    const button = render();
    act(() => button.click());
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.dataset.reading).toBe('dyslexic');
    act(() => button.click());
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(document.documentElement.dataset.reading).toBeUndefined();
    expect(window.localStorage.getItem('accesslens-reading-font')).toBeNull();
  });

  it('remembers the choice on this device only', () => {
    const first = render();
    act(() => first.click());
    act(() => root!.unmount());
    container?.remove();
    delete document.documentElement.dataset.reading;
    expect(window.localStorage.getItem('accesslens-reading-font')).toBe('dyslexic');
    const again = render();
    expect(again.getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.dataset.reading).toBe('dyslexic');
  });
});
