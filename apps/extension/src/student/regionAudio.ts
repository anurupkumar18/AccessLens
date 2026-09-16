import type { AccessPack } from '../shared/contracts';
import { regionAudioUrl } from '../shared/packMedia';
import type { Region } from './packOutline';

/** Where the audio that is playing came from. */
export type PlaybackSource = 'published' | 'synthesized' | 'browser' | 'unavailable';

export interface RegionPlayerDeps {
  /** Reviewed-text speech from the AI gateway (Amazon Polly), for packs that ship no audio. */
  speak?: (assetId: string, regionId: string) => Promise<Blob>;
  /** Injected in tests; otherwise the browser's Audio element. */
  createAudio?: (url: string) => HTMLAudioElement;
  /** Injected in tests; otherwise the window's speech synthesis, if any. */
  speechSynthesis?: Pick<SpeechSynthesis, 'cancel' | 'speak'> | null;
}

export interface RegionPlayer {
  /** Plays one region's reviewed description, stopping whatever was playing. Resolves when playback has started. */
  play(assetId: string, region: Region): Promise<PlaybackSource>;
  /** Stops any playback started by this player. */
  stop(): void;
  /** Fires when playback started by `play` ends on its own. */
  onEnded(listener: () => void): () => void;
}

function defaultCreateAudio(url: string): HTMLAudioElement {
  return new Audio(url);
}

function browserSpeech(): Pick<SpeechSynthesis, 'cancel' | 'speak'> | null {
  return 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined' ? window.speechSynthesis : null;
}

/**
 * Plays a pack's region descriptions on the student's request, any region in
 * any order, independent of what the instructor is showing. The pack's own
 * reviewed audio comes first (the publish route wrote one MP3 per region next
 * to the pack); a pack without audio is synthesized through the gateway; and
 * without either, the browser voice reads the same reviewed text. Nothing
 * here knows about the live session, so it can be lifted out as is.
 */
export function createRegionPlayer(pack: AccessPack, deps: RegionPlayerDeps = {}): RegionPlayer {
  const createAudio = deps.createAudio ?? defaultCreateAudio;
  const speech = deps.speechSynthesis === undefined ? browserSpeech() : deps.speechSynthesis;
  const listeners = new Set<() => void>();
  let current: HTMLAudioElement | null = null;
  let generation = 0;

  function ended(): void { for (const listener of listeners) listener(); }

  function stop(): void {
    generation += 1;
    if (current) { current.pause(); current = null; }
    speech?.cancel();
  }

  async function start(url: string, cleanup?: () => void): Promise<void> {
    const audio = createAudio(url);
    const mine = generation;
    audio.addEventListener('ended', () => { cleanup?.(); if (generation === mine) { current = null; ended(); } }, { once: true });
    current = audio;
    await audio.play();
  }

  return {
    async play(assetId, region) {
      stop();
      const mine = generation;
      const published = regionAudioUrl(pack, region);
      if (published) {
        try { await start(published); return 'published'; } catch { /* fall through: the same reviewed text, synthesized */ }
      }
      if (deps.speak) {
        try {
          const blob = await deps.speak(assetId, region.regionId);
          if (generation !== mine) return 'unavailable';
          const url = URL.createObjectURL(blob);
          await start(url, () => URL.revokeObjectURL(url));
          return 'synthesized';
        } catch { /* fall through to the browser voice: same reviewed text, no network */ }
      }
      if (generation !== mine) return 'unavailable';
      if (!speech) return 'unavailable';
      const utterance = new SpeechSynthesisUtterance(region.shortDescription);
      utterance.addEventListener('end', () => { if (generation === mine) ended(); }, { once: true });
      speech.speak(utterance);
      return 'browser';
    },
    stop,
    onEnded(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
