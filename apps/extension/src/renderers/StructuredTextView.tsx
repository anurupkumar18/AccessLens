import React from 'react';
import type { AccessPack } from '../shared/contracts';

interface Props {
  pack: AccessPack;
  assetId?: string;
  regionId?: string;
}

export function StructuredTextView({ pack, assetId, regionId }: Props): React.ReactElement {
  const asset = pack.assets.find((candidate) => candidate.assetId === assetId) ?? pack.assets[0];
  if (!asset) return <p role="status">Waiting for reviewed lesson text.</p>;
  const active = asset.regions.find((candidate) => candidate.regionId === regionId);

  return (
    <section className="mode-panel" aria-labelledby="structured-title">
      <p className="eyebrow">Structured text</p>
      <h3 id="structured-title">{asset.title}</h3>
      {active ? (
        <div className="active-concept">
          <h4>{active.regionId}</h4>
          <p>{active.shortDescription}</p>
        </div>
      ) : null}
      <h4>Reading order</h4>
      <ol>
        {asset.readingOrder.map((item) => <li key={item}>{item}</li>)}
      </ol>
    </section>
  );
}
