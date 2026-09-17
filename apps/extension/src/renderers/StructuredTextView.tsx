import React from 'react';
import type { AccessPack } from '../shared/contracts';
import { packOutline, regionName } from '../student/packOutline';

interface Props {
  pack: AccessPack;
  /** The slide the instructor is on, when a session is live. */
  assetId?: string;
  /** The region the instructor has pointed at on that slide. */
  regionId?: string;
}

/**
 * Read mode: the whole lesson's reviewed text, slide by slide in reading
 * order, for the student to read at their own pace. It is the mode a
 * screen reader lands in first, so it is plain document structure: one
 * landmark, a table of contents, an article per slide with heading levels
 * a rotor can walk, and the instructor's slide marked with `aria-current`
 * and a skip link so the student can follow along without leaving Read.
 * Nothing inside is focusable except that heading: focusable containers
 * collapse into a single screen-reader item and hide their children.
 * Focus mode crops to the instructor's position instead.
 */
export function StructuredTextView({ pack, assetId, regionId }: Props): React.ReactElement {
  const slides = packOutline(pack);
  if (slides.length === 0) return <p role="status">This lesson has no reviewed text yet.</p>;
  const instructorSlide = slides.find(({ asset }) => asset.assetId === assetId);

  return (
    <section className="mode-panel read-view" aria-labelledby="structured-title">
      <p className="eyebrow" aria-hidden="true">Read</p>
      <h3 id="structured-title">{pack.title}</h3>
      {instructorSlide && (
        <a className="skip-link" href={`#read-title-${instructorSlide.asset.assetId}`}>
          Skip to the instructor's slide: {instructorSlide.asset.title}
        </a>
      )}
      <nav aria-label="Slides in this lesson">
        <ol className="read-contents">
          {slides.map(({ asset }) => (
            <li key={asset.assetId}>
              <a href={`#read-${asset.assetId}`} aria-current={asset.assetId === assetId ? 'true' : undefined}>
                {asset.title}
                {asset.assetId === assetId && <span className="visually-hidden"> (instructor is here)</span>}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {slides.map(({ asset, regions }) => {
        const current = asset.assetId === assetId;
        return (
          <article
            key={asset.assetId}
            id={`read-${asset.assetId}`}
            className={`read-slide${current ? ' read-slide--current' : ''}`}
            aria-labelledby={`read-title-${asset.assetId}`}
            aria-current={current ? 'true' : undefined}
          >
            {/* The skip link lands on the heading, not the article: a focusable
                article becomes one VoiceOver item whose whole text reads at once,
                and VO+Right cannot step through the regions inside it. */}
            <h4 id={`read-title-${asset.assetId}`} tabIndex={-1}>
              {asset.title}
              {current && <span className="read-here"> <span className="visually-hidden">— </span>Instructor is on this slide</span>}
            </h4>
            {regions.length === 0 ? <p className="supporting-text">No reviewed descriptions on this slide.</p> : (
              <ol className="read-regions">
                {regions.map((region) => {
                  const pointed = current && region.regionId === regionId;
                  return (
                    <li key={region.regionId} id={`read-${asset.assetId}-${region.regionId}`} aria-current={pointed ? 'true' : undefined}>
                      <h5>
                        {regionName(region)}
                        {pointed && <span className="visually-hidden"> (instructor is pointing here)</span>}
                      </h5>
                      <p>{region.shortDescription}</p>
                      {region.plainLanguage !== region.shortDescription && (
                        <p className="supporting-text"><span className="visually-hidden">In plain language: </span>{region.plainLanguage}</p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </article>
        );
      })}
    </section>
  );
}
