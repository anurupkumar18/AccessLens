// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { InMemorySessionClient, type LiveEvent, type RoleCapability } from '../shared/contracts';
import type { AiClient } from '../shared/aiClient';
import { validEvent, validPack } from '../shared/fixtures';
import { defaultPreferences, type StudentPreferences } from '../shared/preferences';
import { StudentExperience } from './StudentExperience';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class SignedClient extends InMemorySessionClient {
  override async join(sessionId: string): Promise<RoleCapability> {
    return { ...(await super.join(sessionId)), token: 'signed-by-relay' };
  }
}

const caption = (text: string, isFinal: boolean, sequence: number): LiveEvent => ({
  schemaVersion: '1.0', type: 'caption.appended', sessionId: 'demo-session', packId: 'bio-cell-demo', packVersion: 1,
  assetId: 'cell-slide-03', caption: { text, isFinal }, sequence, sentAt: '2026-09-15T15:00:05Z',
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  window.localStorage.clear();
});

function render(client: InMemorySessionClient, ai: AiClient | null, preferences: StudentPreferences = defaultPreferences): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(
    <StudentExperience client={client} event={validEvent} pack={validPack} preferences={preferences} onPreferencesChange={() => undefined} ai={ai} chat={null} />,
  ));
}

async function join(): Promise<void> {
  const input = container!.querySelector<HTMLInputElement>('#session-code')!;
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setValue.call(input, 'JOIN42');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { container!.querySelector('.join-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
}

async function typeQuestion(text: string): Promise<void> {
  const input = container!.querySelector<HTMLInputElement>('#ask-question')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { container!.querySelector('.ask-class form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
}

describe('student live captions', () => {
  it('shows the instructor words labelled as live captions, with the latest partial after the finals', () => {
    const client = new InMemorySessionClient();
    render(client, null);
    expect(container!.textContent).toContain('Captions appear here when your instructor turns them on.');
    act(() => {
      client.send(caption('The mitochondrion releases energy.', true, 2));
      client.send(caption('Notice the folded', false, 3));
    });
    const lines = container!.querySelector('.caption-lines')!;
    expect(lines.textContent).toContain('The mitochondrion releases energy.');
    expect(lines.querySelector('.caption-partial')?.textContent).toBe('Notice the folded');
    expect(container!.textContent).toContain('not reviewed text');
    // Reviewed description is still there, untouched by captions.
    expect(container!.textContent).toContain('Following mitochondrion on cell-slide-03.');
  });

  it('keeps screen-reader announcement off until the student turns it on, and remembers it locally', () => {
    render(new InMemorySessionClient(), null);
    const log = container!.querySelector('.caption-lines')!;
    expect(log.getAttribute('aria-live')).toBe('off');
    act(() => { container!.querySelector<HTMLInputElement>('#announce-captions')!.click(); });
    expect(log.getAttribute('aria-live')).toBe('polite');
    expect(window.localStorage.getItem('accesslens-announce-captions')).toBe('on');
  });
});

describe('Ask this class', () => {
  it('asks only after joining a relay session, and shows the answer with the lesson parts it came from', async () => {
    const ai = { ask: vi.fn(async () => ({ status: 'answered' as const, answer: 'It releases usable energy for the cell.', citations: [{ assetId: 'cell-slide-03', assetTitle: 'Mitochondria and Energy', regionId: 'mitochondrion', label: 'Mitochondrion' }] })) } as unknown as AiClient;
    render(new SignedClient(), ai);
    expect(container!.querySelector('#ask-question')).toBeNull();
    expect(container!.textContent).toContain('Join a live session with its code to ask questions');
    await join();
    await typeQuestion('What does the mitochondrion do?');
    expect(ai.ask).toHaveBeenCalledWith(expect.objectContaining({ token: 'signed-by-relay', role: 'student' }), 'bio-cell-demo', 1, 'What does the mitochondrion do?');
    expect(container!.textContent).toContain('It releases usable energy for the cell.');
    expect(container!.textContent).toContain('Mitochondrion (Mitochondria and Energy)');
  });

  it('shows a plain decline instead of a guess', async () => {
    const ai = { ask: vi.fn(async () => ({ status: 'declined' as const, reason: 'no-reviewed-material' })) } as unknown as AiClient;
    render(new SignedClient(), ai);
    await join();
    await typeQuestion('Who won the World Cup?');
    expect(container!.textContent).toContain("reviewed material doesn't cover that");
  });

  it('passes an axe check with captions and Ask present', async () => {
    const ai = { ask: vi.fn() } as unknown as AiClient;
    render(new SignedClient(), ai);
    await join();
    const results = await axe.run(container!, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map(v => v.id)).toEqual([]);
  });
});

describe('Hear mode with Amazon Polly', () => {
  it('plays the reviewed description through the gateway after joining, and falls back to the browser voice when it fails', async () => {
    const play = vi.fn(async () => undefined);
    vi.stubGlobal('Audio', vi.fn(function FakeAudio() { return { play, addEventListener: vi.fn() }; }));
    const createObjectURL = vi.fn(() => 'blob:audio');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const speak = vi.fn(async () => new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }));
    render(new SignedClient(), { speak } as unknown as AiClient, { ...defaultPreferences, mode: 'audio' });
    await join();
    const playButton = [...container!.querySelectorAll('button')].find(b => b.textContent === 'Play description')!;
    await act(async () => { playButton.click(); });
    expect(speak).toHaveBeenCalledWith(expect.objectContaining({ token: 'signed-by-relay' }), 'bio-cell-demo', 1, 'cell-slide-03', 'mitochondrion', 'shortDescription');
    expect(play).toHaveBeenCalled();
    expect(container!.textContent).toContain('(Amazon Polly)');

    speak.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { playButton.click(); });
    expect(container!.textContent).toMatch(/Speech is unavailable here|Playing description/);
    vi.unstubAllGlobals();
  });
});
