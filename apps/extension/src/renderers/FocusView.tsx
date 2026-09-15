import React from 'react';
import type { AccessPack } from '../shared/contracts';

interface Props {
  pack: AccessPack;
  assetId?: string;
  regionId?: string;
}

export function FocusView({ pack, assetId, regionId }: Props): React.ReactElement {
  const asset = pack.assets.find((candidate) => candidate.assetId === assetId) ?? pack.assets[0];
  const region = asset?.regions.find((candidate) => candidate.regionId === regionId) ?? asset?.regions[0];

  if (!asset || !region) return <p role="status">Waiting for a reviewed focus region.</p>;

  return (
    <section className="mode-panel focus-view" aria-labelledby="focus-title">
      <p className="eyebrow">Focus view</p>
      <h3 id="focus-title">{region.regionId}</h3>
      <div className="focus-diagram" role="img" aria-label={`${region.regionId}: ${region.shortDescription}`}>
        <div className="cell-membrane" aria-hidden="true">
          <div className="cell-nucleus" />
          <div className="cell-mitochondrion active" />
        </div>
      </div>
      <p>{region.plainLanguage}</p>
      <p className="supporting-text">{region.shortDescription}</p>
    </section>
  );
}
