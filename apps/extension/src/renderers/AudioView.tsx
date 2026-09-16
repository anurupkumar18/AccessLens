import React, { useState } from 'react';
import type { AccessPack } from '../shared/contracts';
import { regionAudioUrl } from '../shared/packMedia';

interface Props {
  pack: AccessPack;
  assetId?: string;
  regionId?: string;
  /** Student-selected browser-voice rate, used only on the browser-fallback path. */
  speechRate?: number;
  /** Reviewed-text speech from the AI gateway (Amazon Polly), used when the pack ships no audio of its own. Absent or failing, the browser voice reads the same text. */
  speak?: (assetId: string, regionId: string) => Promise<Blob>;
  /** Injected in tests; otherwise the browser's Audio element. */
  createAudio?: (url: string) => HTMLAudioElement;
}

type FallbackReason = 'not-in-session' | 'polly-failed' | 'recording-failed';

/**
 * Why the browser voice is reading instead of the AI voice. Amazon Polly is
 * only spoken for someone in a live session (the gateway checks the relay's
 * capability), so a student who presses Play before joining hears the browser
 * voice, and should be told how to get the other one.
 */
const FALLBACK_MESSAGES: Record<FallbackReason, string> = {
  'not-in-session': "Browser voice: join a live session to hear the Amazon Polly voice.",
  'polly-failed': 'Browser voice: Amazon Polly did not answer.',
  'recording-failed': 'Browser voice: the recorded audio did not load.',
};

function defaultCreateAudio(url: string): HTMLAudioElement {
  return new Audio(url);
}

export function AudioView({ pack, assetId, regionId, speechRate = 1, speak, createAudio = defaultCreateAudio }: Props): React.ReactElement {
  const [message, setMessage] = useState('Audio is ready and will play only when requested.');
  const asset = pack.assets.find((candidate) => candidate.assetId === assetId) ?? pack.assets[0];
  const region = asset?.regions.find((candidate) => candidate.regionId === regionId) ?? asset?.regions[0];

  async function play(): Promise<void> {
    if (!region || !asset) return;
    // The pack's own reviewed audio comes first: the publish route wrote one
    // MP3 per region next to the pack, so a published pack never needs live
    // synthesis. Speech is only for packs that ship no audio.
    const published = regionAudioUrl(pack, region);
    let fallback: FallbackReason = speak ? 'polly-failed' : 'not-in-session';
    if (published) {
      try {
        await createAudio(published).play();
        setMessage(`Playing the reviewed audio for ${region.regionId} (published with the pack).`);
        return;
      } catch {
        // Fall through: the same reviewed text, synthesized instead.
        if (!speak) fallback = 'recording-failed';
      }
    }
    if (speak) {
      try {
        const url = URL.createObjectURL(await speak(asset.assetId, region.regionId));
        const audio = createAudio(url);
        audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
        await audio.play();
        setMessage(`Playing the reviewed description for ${region.regionId} (Amazon Polly).`);
        return;
      } catch {
        // Fall through to the browser voice: same reviewed text, no network.
      }
    }
    speakWithBrowser(fallback);
  }

  function speakWithBrowser(reason: FallbackReason): void {
    if (!region) return;
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      setMessage('Speech is unavailable here. The same description is shown as text.');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(region.shortDescription);
    utterance.rate = speechRate;
    window.speechSynthesis.speak(utterance);
    setMessage(`${FALLBACK_MESSAGES[reason]} Playing description for ${region.regionId}.`);
  }

  if (!region) return <p role="status">Waiting for a reviewed audio description.</p>;

  return (
    <section className="mode-panel" aria-labelledby="audio-title">
      <p className="eyebrow">Requested audio</p>
      <h3 id="audio-title">{region.regionId}</h3>
      <p>{region.shortDescription}</p>
      <button type="button" onClick={() => { void play(); }}>Play description</button>
      <p role="status" className="supporting-text">{message}</p>
    </section>
  );
}
