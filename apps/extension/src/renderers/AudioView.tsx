import React, { useEffect, useMemo, useState } from 'react';
import type { AccessPack } from '../shared/contracts';
import { packOutline, regionName } from '../student/packOutline';
import { createRegionPlayer, type PlaybackSource, type RegionPlayerDeps } from '../student/regionAudio';

interface Props extends RegionPlayerDeps {
  pack: AccessPack;
}

const sourceNote: Record<PlaybackSource, string> = {
  published: 'reviewed audio published with the pack',
  synthesized: 'reviewed description, Amazon Polly',
  browser: 'reviewed description, browser voice',
  unavailable: 'speech is unavailable here; the same description is shown as text',
};

/**
 * Hear mode: every region of every slide, playable in any order the student
 * chooses. It never follows the instructor; Focus mode does that.
 */
export function AudioView({ pack, speak, createAudio, speechSynthesis }: Props): React.ReactElement {
  const player = useMemo(() => createRegionPlayer(pack, { speak, createAudio, speechSynthesis }), [pack, speak, createAudio, speechSynthesis]);
  const [playing, setPlaying] = useState<string | null>(null);
  const [message, setMessage] = useState('Choose any description below to hear it. Nothing plays until you ask.');
  const slides = packOutline(pack);

  useEffect(() => {
    const off = player.onEnded(() => setPlaying(null));
    return () => { off(); player.stop(); };
  }, [player]);

  async function play(assetId: string, key: string, region: (typeof slides)[number]['regions'][number]): Promise<void> {
    setPlaying(key);
    const source = await player.play(assetId, region);
    if (source === 'unavailable') { setPlaying(null); setMessage(`Could not play ${regionName(region)}: ${sourceNote.unavailable}.`); return; }
    setMessage(`Playing ${regionName(region)} (${sourceNote[source]}).`);
  }

  function stop(): void {
    player.stop();
    setPlaying(null);
    setMessage('Stopped.');
  }

  if (slides.every((slide) => slide.regions.length === 0)) return <p role="status">This lesson has no reviewed audio descriptions yet.</p>;

  return (
    <section className="mode-panel hear-view" aria-labelledby="audio-title">
      <p className="eyebrow">Hear</p>
      <h3 id="audio-title">{pack.title}</h3>
      <p role="status" className="supporting-text" aria-live="polite">{message}</p>
      {playing && <button type="button" className="secondary" onClick={stop}>Stop</button>}
      {slides.map(({ asset, regions }) => regions.length === 0 ? null : (
        <section key={asset.assetId} className="hear-slide" aria-labelledby={`hear-${asset.assetId}`}>
          <h4 id={`hear-${asset.assetId}`}>{asset.title}</h4>
          <ol className="hear-regions">
            {regions.map((region) => {
              const key = `${asset.assetId}/${region.regionId}`;
              return (
                <li key={region.regionId}>
                  <button
                    type="button"
                    className="hear-play"
                    aria-pressed={playing === key}
                    aria-label={`Play ${regionName(region)}`}
                    onClick={() => { void play(asset.assetId, key, region); }}
                  >
                    <span aria-hidden="true">{playing === key ? '▮▮' : '▶'}</span> {regionName(region)}
                  </button>
                  <p>{region.shortDescription}</p>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </section>
  );
}
