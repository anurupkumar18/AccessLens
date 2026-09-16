import React, { useState } from 'react';
import type { AccessPack } from '../shared/contracts';

interface Props {
  pack: AccessPack;
  assetId?: string;
  regionId?: string;
  speechRate: number;
}

export function AudioView({ pack, assetId, regionId, speechRate }: Props): React.ReactElement {
  const [message, setMessage] = useState('Audio is ready and will play only when requested.');
  const asset = pack.assets.find((candidate) => candidate.assetId === assetId) ?? pack.assets[0];
  const region = asset?.regions.find((candidate) => candidate.regionId === regionId) ?? asset?.regions[0];

  function speak(): void {
    if (!region) return;
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      setMessage('Speech is unavailable here. The same description is shown as text.');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(region.shortDescription);
    utterance.rate = speechRate;
    window.speechSynthesis.speak(utterance);
    setMessage(`Playing description for ${region.regionId}.`);
  }

  if (!region) return <p role="status">Waiting for a reviewed audio description.</p>;

  return (
    <section className="mode-panel" aria-labelledby="audio-title">
      <p className="eyebrow">Requested audio</p>
      <h3 id="audio-title">{region.regionId}</h3>
      <p>{region.shortDescription}</p>
      <button type="button" onClick={speak}>Play description</button>
      <p role="status" className="supporting-text">{message}</p>
    </section>
  );
}
