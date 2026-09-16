import React, { useState } from 'react';
import type { AccessPack } from '../shared/contracts';

interface Props {
  pack: AccessPack;
  assetId?: string;
  regionId?: string;
  /** Reviewed-text speech from the AI gateway (Amazon Polly). Absent or failing, the browser voice reads the same text. */
  speak?: (assetId: string, regionId: string) => Promise<Blob>;
}

export function AudioView({ pack, assetId, regionId, speak }: Props): React.ReactElement {
  const [message, setMessage] = useState('Audio is ready and will play only when requested.');
  const asset = pack.assets.find((candidate) => candidate.assetId === assetId) ?? pack.assets[0];
  const region = asset?.regions.find((candidate) => candidate.regionId === regionId) ?? asset?.regions[0];

  async function play(): Promise<void> {
    if (!region || !asset) return;
    if (speak) {
      try {
        const url = URL.createObjectURL(await speak(asset.assetId, region.regionId));
        const audio = new Audio(url);
        audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
        await audio.play();
        setMessage(`Playing the reviewed description for ${region.regionId} (Amazon Polly).`);
        return;
      } catch {
        // Fall through to the browser voice: same reviewed text, no network.
      }
    }
    speakWithBrowser();
  }

  function speakWithBrowser(): void {
    if (!region) return;
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      setMessage('Speech is unavailable here. The same description is shown as text.');
      return;
    }
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(region.shortDescription));
    setMessage(`Playing description for ${region.regionId}.`);
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
