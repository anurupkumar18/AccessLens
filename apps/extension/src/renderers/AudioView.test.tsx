// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validPack } from '../shared/fixtures';
import { AudioView } from './AudioView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('AudioView', () => {
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    container?.remove();
    container = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses the local chosen rate only after the student requests playback', async () => {
    const utterances: SpeechSynthesisUtterance[] = [];
    class FakeUtterance {
      rate = 1;
      constructor(readonly text: string) {}
    }
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel: vi.fn(), speak: (utterance: SpeechSynthesisUtterance) => utterances.push(utterance) } });
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<AudioView pack={validPack} assetId="cell-slide-03" regionId="mitochondrion" speechRate={1.25} />));
    expect(utterances).toEqual([]);
    await act(async () => (container!.querySelector('button') as HTMLButtonElement).click());
    expect(utterances).toHaveLength(1);
    expect(utterances[0].rate).toBe(1.25);
    root.unmount();
  });
});
