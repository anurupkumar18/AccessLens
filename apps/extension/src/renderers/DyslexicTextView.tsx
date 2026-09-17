import React, { useState } from 'react';
import type { AccessPack } from '../shared/contracts';
import { packOutline, regionName } from '../student/packOutline';

interface Props {
  pack: AccessPack;
}

/**
 * A student-controlled reading presentation of the whole lesson (AGENTS.md:
 * accessibility preferences stay student-local and are named by what they do,
 * never by a diagnosis). It does not send a preference to the instructor or
 * follow the instructor's position; it applies spacing, line length, weight,
 * and a dyslexia-friendly font stack to the same reviewed text Read mode shows.
 */
export function DyslexicTextView({ pack }: Props): React.ReactElement {
  const [enabled, setEnabled] = useState(true);
  const slides = packOutline(pack);
  if (slides.length === 0) return <p role="status">This lesson has no reviewed text yet.</p>;

  return (
    <section className={`mode-panel dyslexic-view${enabled ? ' dyslexic-view--enabled' : ''}`} aria-labelledby="dyslexic-title">
      <p className="eyebrow">Reading spacing</p>
      <h3 id="dyslexic-title">{pack.title}</h3>
      <button
        type="button"
        className="dyslexic-toggle"
        aria-pressed={enabled}
        onClick={() => setEnabled((current) => !current)}
      >
        {enabled ? 'Turn off reading spacing' : 'Turn on reading spacing'}
      </button>
      <div className="dyslexic-reading">
        {slides.map(({ asset, regions }) => (
          <section key={asset.assetId} className="read-slide" aria-labelledby={`dyslexic-${asset.assetId}`}>
            <h4 id={`dyslexic-${asset.assetId}`}>{asset.title}</h4>
            <ol className="read-regions">
              {regions.map((region) => (
                <li key={region.regionId}>
                  <h5>{regionName(region)}</h5>
                  <p>{region.plainLanguage}</p>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </section>
  );
}
