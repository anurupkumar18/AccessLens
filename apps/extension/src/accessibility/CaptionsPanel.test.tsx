// @vitest-environment jsdom
/**
 * Captions are the primary access route for a deaf or hard-of-hearing student,
 * so the behaviours here are correctness rather than polish: interim results
 * must replace rather than accumulate, the transcript must be a live region an
 * assistive technology will actually announce, and a language tag must reach
 * the markup so a screen reader switches voices.
 */
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { CaptionsPanel } from './CaptionsPanel';
import type { LiveEvent } from '../shared/contracts';

let container: HTMLDivElement;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
});

function render(): (event: LiveEvent | null, listening?: boolean) => void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  return (event, listening = true) => {
    act(() => {
      root?.render(<CaptionsPanel event={event} listening={listening} reducedMotion={true} />);
    });
  };
}

const caption = (text: string, isFinal: boolean, sequence: number, lang?: string): LiveEvent =>
  ({
    schemaVersion: '1.0',
    type: 'caption.appended',
    sessionId: 's',
    packId: 'bio-cell-demo',
    packVersion: 1,
    sequence,
    sentAt: '2026-09-16T00:00:00Z',
    caption: { text, isFinal, ...(lang ? { lang } : {}) },
  }) as unknown as LiveEvent;

const transcript = () => container.querySelector('.a11y-transcript') as HTMLElement;

describe('CaptionsPanel', () => {
  it('exposes the transcript as a labelled live region', () => {
    render()(null);
    const log = transcript();
    expect(log.getAttribute('role')).toBe('log');
    expect(log.getAttribute('aria-live')).toBe('polite');
    expect(log.getAttribute('aria-label')).toBeTruthy();
  });

  it('is reachable and scrollable by keyboard', () => {
    render()(null);
    // Without tabIndex a keyboard user cannot scroll back through what was
    // said, which is most of the value of having a transcript at all.
    expect(transcript().getAttribute('tabindex')).toBe('0');
  });

  it('shows a final caption', () => {
    const update = render();
    update(caption('The mitochondrion releases energy.', true, 1));
    expect(transcript().textContent).toContain('The mitochondrion releases energy.');
  });

  it('replaces an interim caption in place rather than appending', () => {
    const update = render();
    update(caption('The mito', false, 1));
    update(caption('The mitochondrion', false, 2));
    update(caption('The mitochondrion releases energy.', true, 3));
    const paragraphs = transcript().querySelectorAll('p');
    expect(paragraphs.length).toBe(1);
    expect(paragraphs[0].textContent).toBe('The mitochondrion releases energy.');
  });

  it('keeps finalised lines and starts a new one after them', () => {
    const update = render();
    update(caption('First sentence.', true, 1));
    update(caption('Second', false, 2));
    expect(transcript().querySelectorAll('p').length).toBe(2);
  });

  it('marks an interim line so it is distinguishable without colour', () => {
    const update = render();
    update(caption('still deciding', false, 1));
    expect(transcript().querySelector('.a11y-interim')).not.toBeNull();
  });

  it('passes a language tag through so a screen reader switches voice', () => {
    const update = render();
    update(caption('La mitocondria libera energía.', true, 1, 'es'));
    expect(transcript().querySelector('p[lang="es"]')).not.toBeNull();
  });

  it('ignores events that are not captions', () => {
    const update = render();
    update({
      schemaVersion: '1.0',
      type: 'region.changed',
      sessionId: 's',
      packId: 'p',
      packVersion: 1,
      sequence: 1,
      sentAt: '2026-09-16T00:00:00Z',
      assetId: 'a',
      regionId: 'r',
    } as unknown as LiveEvent);
    expect(transcript().textContent).toContain('No captions yet');
  });

  it('says captions can mishear while listening', () => {
    // An honesty requirement, not a nicety: a student relying on a transcript
    // needs to know it is machine transcription.
    render()(null, true);
    expect(container.textContent?.toLowerCase()).toContain('mishear');
  });
});
