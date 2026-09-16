// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRegionPlayer } from './regionAudio';
import { AccessPackSchema, type AccessPack } from '../shared/contracts';
import { registerRemotePackBase, resetRemotePackBasesForTests } from '../shared/packMedia';
import reviewedBioPack from '../../../../packages/access-packs/bio-cell-demo/pack.json';

const bioPack = AccessPackSchema.parse(reviewedBioPack);
const asset = bioPack.assets[0];
const [first, second] = asset.regions;
const publishedPack: AccessPack = {
  ...bioPack, packId: 'published-pack',
  assets: [{ ...asset, regions: asset.regions.map((r) => ({ ...r, audioUri: `media/published-pack/1/${asset.assetId}.${r.regionId}.mp3` })) }],
};
const [publishedFirst, publishedSecond] = publishedPack.assets[0].regions;

function fakeAudio() {
  const created: Array<{ url: string; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; end(): void }> = [];
  const create = (url: string) => {
    let onEnded: (() => void) | undefined;
    const element = { url, play: vi.fn(async () => undefined), pause: vi.fn(), end: () => onEnded?.(), addEventListener: (_: string, listener: () => void) => { onEnded = listener; } };
    created.push(element);
    return element as unknown as HTMLAudioElement;
  };
  return { created, create };
}

afterEach(() => resetRemotePackBasesForTests());

describe('createRegionPlayer', () => {
  it('plays published clips in any order, stopping the previous one, and reports when a clip ends', async () => {
    registerRemotePackBase('published-pack', new URL('https://d.example.net/'));
    const audio = fakeAudio();
    const player = createRegionPlayer(publishedPack, { createAudio: audio.create, speechSynthesis: null });
    const ended = vi.fn();
    player.onEnded(ended);

    expect(await player.play(asset.assetId, publishedSecond)).toBe('published');
    expect(await player.play(asset.assetId, publishedFirst)).toBe('published');
    expect(audio.created.map((a) => a.url)).toEqual([
      `https://d.example.net/media/published-pack/1/${asset.assetId}.${second.regionId}.mp3`,
      `https://d.example.net/media/published-pack/1/${asset.assetId}.${first.regionId}.mp3`,
    ]);
    expect(audio.created[0].pause).toHaveBeenCalledTimes(1);

    audio.created[0].end();
    expect(ended).not.toHaveBeenCalled();
    audio.created[1].end();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('falls back to the gateway, then to the browser voice, then reports unavailable', async () => {
    const audio = fakeAudio();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = () => 'blob:synth';
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = () => undefined;
    const speak = vi.fn(async () => new Blob(['mp3']));
    expect(await createRegionPlayer(bioPack, { speak, createAudio: audio.create, speechSynthesis: null }).play(asset.assetId, first)).toBe('synthesized');
    expect(speak).toHaveBeenCalledWith(asset.assetId, first.regionId);

    const speech = { cancel: vi.fn(), speak: vi.fn() };
    (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance = class { text: string; constructor(text: string) { this.text = text; } addEventListener() { return undefined; } };
    expect(await createRegionPlayer(bioPack, { createAudio: audio.create, speechSynthesis: speech }).play(asset.assetId, first)).toBe('browser');
    expect(speech.speak).toHaveBeenCalledWith(expect.objectContaining({ text: first.shortDescription }));

    expect(await createRegionPlayer(bioPack, { createAudio: audio.create, speechSynthesis: null }).play(asset.assetId, first)).toBe('unavailable');
  });
});
