import React from 'react';
import type { AccessPack } from '../shared/contracts';
import { packOutline, regionName } from '../student/packOutline';

interface Props {
  pack: AccessPack;
}

/**
 * Read mode: the whole lesson's reviewed text, slide by slide in reading
 * order, for the student to read at their own pace. It does not follow the
 * instructor; Focus mode does that.
 */
export function StructuredTextView({ pack }: Props): React.ReactElement {
  const slides = packOutline(pack);
  if (slides.length === 0) return <p role="status">This lesson has no reviewed text yet.</p>;

  return (
    <section className="mode-panel read-view" aria-labelledby="structured-title">
      <p className="eyebrow">Structured text</p>
      <h3 id="structured-title">{pack.title}</h3>
      <nav aria-label="Slides">
        <ol className="read-contents">
          {slides.map(({ asset }) => <li key={asset.assetId}><a href={`#read-${asset.assetId}`}>{asset.title}</a></li>)}
        </ol>
      </nav>
      {slides.map(({ asset, regions }) => (
        <section key={asset.assetId} id={`read-${asset.assetId}`} className="read-slide" aria-labelledby={`read-title-${asset.assetId}`}>
          <h4 id={`read-title-${asset.assetId}`}>{asset.title}</h4>
          {regions.length === 0 ? <p className="supporting-text">No reviewed descriptions on this slide.</p> : (
            <ol className="read-regions">
              {regions.map((region) => (
                <li key={region.regionId}>
                  <h5>{regionName(region)}</h5>
                  <p>{region.shortDescription}</p>
                  {region.plainLanguage !== region.shortDescription && <p className="supporting-text">{region.plainLanguage}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}
    </section>
  );
}
