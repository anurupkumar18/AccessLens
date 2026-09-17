import React, { useState } from 'react';
import type { AccessPack } from '../shared/contracts';

interface Props {
  pack: AccessPack;
  assetId?: string;
  regionId?: string;
}

/**
 * A student-controlled reading presentation (AGENTS.md: accessibility
 * preferences stay student-local and are named by what they do, never by a
 * diagnosis). It does not send a preference to the instructor; it simply
 * applies spacing, line length, weight, and a dyslexia-friendly font stack to
 * the same reviewed text used by Read mode.
 */
export function DyslexicTextView({ pack, assetId, regionId }: Props): React.ReactElement {
  const [enabled, setEnabled] = useState(true);
  const asset = pack.assets.find((candidate) => candidate.assetId === assetId) ?? pack.assets[0];
  if (!asset) return <p role="status">Waiting for reviewed lesson text.</p>;
  const active = asset.regions.find((candidate) => candidate.regionId === regionId);

  return (
    <section className={`mode-panel dyslexic-view${enabled ? ' dyslexic-view--enabled' : ''}`} aria-labelledby="dyslexic-title">
      <p className="eyebrow">Reading spacing</p>
      <h3 id="dyslexic-title">{asset.title}</h3>
      <button
        type="button"
        className="dyslexic-toggle"
        aria-pressed={enabled}
        onClick={() => setEnabled((current) => !current)}
      >
        {enabled ? 'Turn off reading spacing' : 'Turn on reading spacing'}
      </button>
      <div className="dyslexic-reading" aria-live="polite">
        {active ? (
          <div className="active-concept">
            <h4>{active.label ?? active.regionId}</h4>
            <p>{active.plainLanguage}</p>
            <p className="supporting-text">{active.shortDescription}</p>
          </div>
        ) : null}
        <h4>Reading order</h4>
        <ol>
          {asset.readingOrder.map((item) => <li key={item}>{item}</li>)}
        </ol>
      </div>
    </section>
  );
}
