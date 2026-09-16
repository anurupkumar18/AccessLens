import React from 'react';
import type { AccessPack } from '../shared/contracts';
import { slideImageUrl } from '../shared/packMedia';

interface Props {
  pack: AccessPack;
  assetId?: string;
  regionId?: string;
  /** Reviewed semantic focus point, normalized to the asset. */
  pointer?: { x: number; y: number };
}

/**
 * Focus mode shows the slide the instructor is on with the followed region
 * outlined where the pack says it is. Everything comes from the pack:
 * the image from `mediaUri`, the outline from `region.bounds`, the words
 * from the reviewed descriptions. A pack that ships no image gets the text
 * alone; nothing here knows what any particular lesson is about.
 */
export function FocusView({ pack, assetId, regionId, pointer }: Props): React.ReactElement {
  const asset = pack.assets.find((candidate) => candidate.assetId === assetId) ?? pack.assets[0];
  const region = asset?.regions.find((candidate) => candidate.regionId === regionId) ?? asset?.regions[0];

  if (!asset || !region) return <p role="status">Waiting for a reviewed focus region.</p>;

  const imageUrl = slideImageUrl(pack, asset);
  const heading = region.label ?? region.regionId;
  const { x, y, width, height } = region.bounds;

  return (
    <section className="mode-panel focus-view" aria-labelledby="focus-title">
      <p className="eyebrow">Focus view · {asset.title}</p>
      <h3 id="focus-title">{heading}</h3>
      {imageUrl && (
        <figure className="slide-figure" aria-label={`${heading}: ${region.shortDescription}`}>
          <img className="slide-image" src={imageUrl} alt={asset.title} />
          <div
            className="region-highlight"
            aria-hidden="true"
            style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` }}
          />
          {pointer && (
            <div
              className="focus-pointer"
              aria-hidden="true"
              style={{ left: `${pointer.x * 100}%`, top: `${pointer.y * 100}%` }}
            />
          )}
        </figure>
      )}
      <p>{region.plainLanguage}</p>
      <p className="supporting-text">{region.shortDescription}</p>
    </section>
  );
}
