// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioView } from './AudioView';
import { validPack } from '../shared/fixtures';
import { AccessPackSchema, type AccessPack } from '../shared/contracts';
import { registerRemotePackBase, resetRemotePackBasesForTests } from '../shared/packMedia';
import reviewedBioPack from '../../../../packages/access-packs/bio-cell-demo/pack.json';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bioPack = AccessPackSchema.parse(reviewedBioPack);
const asset = bioPack.assets[0];
const region = asset.regions[0];

/** The bio pack as if the pipeline had published it: same content, one MP3 per region. */
const publishedPack: AccessPack = {
  ...bioPack,
  packId: 'published-pack',
  assets: [{ ...asset, regions: asset.regions.map((r) => ({ ...r, audioUri: `media/published-pack/1/${asset.assetId}.${r.regionId}.mp3` })) }],
};

function fakeAudio(): { create: (url: string) => HTMLAudioElement; urls: string[]; play: ReturnType<typeof vi.fn> } {
  const urls: string[] = [];
  const play = vi.fn(async () => undefined);
  return { urls, play, create: (url) => { urls.push(url); return { play, addEventListener: () => undefined } as unknown as HTMLAudioElement; } };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render(element: React.ReactElement): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(element));
}

async function clickPlay(): Promise<void> {
  const button = container!.querySelector('button') as HTMLButtonElement;
  await act(async () => { button.click(); await Promise.resolve(); });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetRemotePackBasesForTests();
});

describe('AudioView', () => {
  it('plays the published MP3 for the region and never asks the gateway', async () => {
    registerRemotePackBase('published-pack', new URL('https://d.example.net/'));
    const audio = fakeAudio();
    const speak = vi.fn();
    render(<AudioView pack={publishedPack} assetId={asset.assetId} regionId={region.regionId} speak={speak} createAudio={audio.create} />);
    await clickPlay();
    expect(audio.urls).toEqual([`https://d.example.net/media/published-pack/1/${asset.assetId}.${region.regionId}.mp3`]);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(speak).not.toHaveBeenCalled();
    expect(container!.querySelector('[role="status"]')!.textContent).toContain('published with the pack');
  });

  it('synthesizes through the gateway when the pack ships no audio', async () => {
    const audio = fakeAudio();
    const speak = vi.fn(async () => new Blob(['mp3']));
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = () => 'blob:synth';
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = () => undefined;
    render(<AudioView pack={bioPack} assetId={asset.assetId} regionId={region.regionId} speak={speak} createAudio={audio.create} />);
    await clickPlay();
    expect(speak).toHaveBeenCalledWith(asset.assetId, region.regionId);
    expect(audio.urls).toEqual(['blob:synth']);
    expect(container!.querySelector('[role="status"]')!.textContent).toContain('Amazon Polly');
  });

  it('uses the local chosen rate only after the student requests playback, falling back to the browser voice', async () => {
    const utterances: SpeechSynthesisUtterance[] = [];
    class FakeUtterance {
      rate = 1;
      constructor(readonly text: string) {}
    }
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel: vi.fn(), speak: (utterance: SpeechSynthesisUtterance) => utterances.push(utterance) } });
    render(<AudioView pack={validPack} assetId="cell-slide-03" regionId="mitochondrion" speechRate={1.25} />);
    expect(utterances).toEqual([]);
    await clickPlay();
    expect(utterances).toHaveLength(1);
    expect(utterances[0].rate).toBe(1.25);
  });
});
