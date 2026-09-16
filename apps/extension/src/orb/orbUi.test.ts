// @vitest-environment jsdom
/**
 * The orb's accessibility contract.
 *
 * This is an accessibility tool injected into other people's pages. If the orb
 * itself is unusable by keyboard or opaque to a screen reader, the product
 * contradicts its own premise, so these are correctness tests rather than
 * polish.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountOrb, type OrbView } from './orbUi';

const handlers = {
  onAction: vi.fn(),
  onSpeak: vi.fn(),
  onStopSpeaking: vi.fn(),
  onClose: vi.fn(),
};

let view: OrbView;
const shadow = () => (view.root.shadowRoot as ShadowRoot);
const orb = () => shadow().querySelector('.orb') as HTMLButtonElement;
const panel = () => shadow().querySelector('.panel') as HTMLDivElement;

beforeEach(() => {
  Object.values(handlers).forEach(fn => fn.mockReset());
  view = mountOrb(handlers, true);
});
afterEach(() => view.destroy());

describe('the orb control', () => {
  it('is a real button with an accessible name', () => {
    expect(orb().tagName).toBe('BUTTON');
    expect(orb().getAttribute('aria-label')).toMatch(/AccessLens/i);
  });

  it('reports its expanded state, and updates it on open', () => {
    expect(orb().getAttribute('aria-expanded')).toBe('false');
    view.open();
    expect(orb().getAttribute('aria-expanded')).toBe('true');
    expect(orb().getAttribute('aria-label')).toMatch(/close/i);
  });

  it('does not mount a second time into the same page', () => {
    const before = document.querySelectorAll('[data-accesslens-orb]').length;
    expect(before).toBe(1);
  });
});

describe('the panel', () => {
  it('is hidden until opened, and is a labelled dialog', () => {
    expect(panel().hidden).toBe(true);
    expect(panel().getAttribute('role')).toBe('dialog');
    expect(panel().getAttribute('aria-label')).toBeTruthy();
    view.open();
    expect(panel().hidden).toBe(false);
  });

  it('moves focus to the first action, not the close button', () => {
    view.open();
    const focused = shadow().activeElement as HTMLElement;
    expect(focused.tagName).toBe('BUTTON');
    expect(focused.dataset.mode).toBe('explain');
  });

  it('closes on Escape', () => {
    view.open();
    shadow().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(handlers.onClose).toHaveBeenCalled();
  });

  it('routes each action button to its mode', () => {
    view.open();
    for (const mode of ['explain', 'simplify', 'diagram'] as const) {
      (shadow().querySelector(`[data-mode="${mode}"]`) as HTMLButtonElement).click();
      expect(handlers.onAction).toHaveBeenCalledWith(mode);
    }
  });

  it('announces status through a live region', () => {
    const status = shadow().querySelector('.status') as HTMLElement;
    expect(status.getAttribute('aria-live')).toBe('polite');
    view.setBusy(true, 'Explaining this page…');
    expect(status.textContent).toContain('Explaining');
  });

  it('disables speech when the browser has no voices', () => {
    view.destroy();
    view = mountOrb(handlers, false);
    expect((shadow().querySelector('[data-speak]') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('results', () => {
  it('always shows the provenance notice above the content', () => {
    view.open();
    view.showResult('AI-generated. Not reviewed by your instructor.', 'Cells make energy.');
    const result = shadow().querySelector('.result') as HTMLElement;
    const noticeText = (result.querySelector('.notice') as HTMLElement).textContent ?? '';
    expect(noticeText).toContain('AI-generated');
    // The notice node must precede the body node in document order, so it is
    // read first by a screen reader walking the result.
    const children = Array.from(result.children);
    expect(children[0].classList.contains('notice')).toBe(true);
  });

  it('renders sanitised svg when one is supplied', () => {
    view.open();
    view.showResult('notice', 'text', '<svg role="img"><circle r="2"></circle></svg>');
    expect((shadow().querySelector('.result') as HTMLElement).querySelector('svg')).not.toBeNull();
  });

  it('shows errors as text rather than failing silently', () => {
    view.open();
    view.showError('Could not reach the explanation service.');
    expect((shadow().querySelector('.result') as HTMLElement).textContent).toContain('Could not reach');
  });
});
