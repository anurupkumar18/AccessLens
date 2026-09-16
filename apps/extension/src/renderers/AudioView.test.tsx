// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioView } from './AudioView';
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

function fakeAudio(): { create: (url: string) => HTMLAudioElement; urls: string[]; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> } {
  const urls: string[] = [];
  const play = vi.fn(async () => undefined);
  const pause = vi.fn();
  return { urls, play, pause, create: (url) => { urls.push(url); return { play, pause, addEventListener: () => undefined } as unknown as HTMLAudioElement; } };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render(element: React.ReactElement): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(element));
}

async function clickPlay(index = 0): Promise<void> {
  const button = container!.querySelectorAll<HTMLButtonElement>('.hear-play')[index]!;
  await act(async () => { button.click(); await Promise.resolve(); await Promise.resolve(); });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  resetRemotePackBasesForTests();
});

describe('AudioView', () => {
  it('plays the published MP3 for the region and never asks the gateway', async () => {
    registerRemotePackBase('published-pack', new URL('https://d.example.net/'));
    const audio = fakeAudio();
    const speak = vi.fn();
    render(<AudioView pack={publishedPack} speak={speak} createAudio={audio.create} speechSynthesis={null} />);
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
    render(<AudioView pack={bioPack} speak={speak} createAudio={audio.create} speechSynthesis={null} />);
    await clickPlay();
    expect(speak).toHaveBeenCalledWith(asset.assetId, region.regionId);
    expect(audio.urls).toEqual(['blob:synth']);
    expect(container!.querySelector('[role="status"]')!.textContent).toContain('Amazon Polly');
  });

  it('lists every region of every slide in reading order, and starting a second one stops the first', async () => {
    registerRemotePackBase('published-pack', new URL('https://d.example.net/'));
    const audio = fakeAudio();
    render(<AudioView pack={publishedPack} createAudio={audio.create} speechSynthesis={null} />);
    const names = Array.from(container!.querySelectorAll<HTMLButtonElement>('.hear-play')).map((b) => b.getAttribute('aria-label'));
    const ordered = asset.readingOrder.filter((id) => asset.regions.some((r) => r.regionId === id));
    expect(ordered.length).toBe(asset.regions.length);
    expect(names).toEqual(ordered.map((id) => `Play ${asset.regions.find((r) => r.regionId === id)!.label ?? id}`));
    expect(audio.play).not.toHaveBeenCalled();

    await clickPlay(1);
    expect(audio.urls).toEqual([`https://d.example.net/media/published-pack/1/${asset.assetId}.${ordered[1]}.mp3`]);
    expect(container!.querySelectorAll('.hear-play')[1]!.getAttribute('aria-pressed')).toBe('true');

    await clickPlay(0);
    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(audio.urls).toHaveLength(2);
    expect(container!.querySelectorAll('.hear-play')[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(container!.querySelectorAll('.hear-play')[1]!.getAttribute('aria-pressed')).toBe('false');

    const stop = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Stop')!;
    await act(async () => { stop.click(); });
    expect(audio.pause).toHaveBeenCalledTimes(2);
    expect(container!.querySelector('[aria-pressed="true"]')).toBeNull();
  });
});
