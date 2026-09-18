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

export const WHOLE_SLIDE_NOTE = 'When your instructor points at part of this slide, that part is outlined here.';

/**
 * Focus mode shows the slide the instructor is on with the followed region
 * outlined where the pack says it is. Everything comes from the pack:
 * the image from `mediaUri`, the outline from `region.bounds`, the words
 * from the reviewed descriptions. A pack that ships no image gets the text
 * alone; nothing here knows what any particular lesson is about.
 */
export function FocusView({ pack, assetId, regionId, pointer }: Props): React.ReactElement {
  // No fallback to assets[0]: an assetId that names nothing in the pack means
  // recognition has not confirmed a slide yet, not that the first slide is showing.
  const asset = pack.assets.find((candidate) => candidate.assetId === assetId);
  if (!asset) {
    return (
      <p role="status">
        This slide has not been reviewed yet, so Focus has no extra guidance for it. If your instructor turned on live video, check it above for the raw view.
      </p>
    );
  }

  const imageUrl = slideImageUrl(pack, asset);
  // Only a region the instructor pointed at is outlined. Moving to a slide
  // names no part of it, so until then the whole slide is shown, not whichever
  // region the pack happens to list first.
  const region = asset.regions.find((candidate) => candidate.regionId === regionId);
  if (!region) {
    return (
      <section className="mode-panel focus-view" aria-labelledby="focus-title">
        <p className="eyebrow">Focus view · {asset.title}</p>
        <h3 id="focus-title">Whole slide</h3>
        {imageUrl ? (
          <figure className="slide-figure">
            <div className="slide-frame">
              <img className="slide-image" src={imageUrl} alt={asset.title} />
            </div>
            <figcaption className="supporting-text">{WHOLE_SLIDE_NOTE}</figcaption>
          </figure>
        ) : (
          <p className="supporting-text">{WHOLE_SLIDE_NOTE}</p>
        )}
      </section>
    );
  }

  const heading = region.label ?? region.regionId;
  const { x, y, width, height } = region.bounds;
  // The pointer marks the region from outside its outline, so it never covers
  // the words or diagram it points at: at the top-left corner when there is
  // room, otherwise at the bottom-right.
  const pointerAt = !pointer ? null
    : x >= 0.05 && y >= 0.08 ? { corner: 'start', left: x, top: y }
    : x + width <= 0.95 && y + height <= 0.92 ? { corner: 'end', left: x + width, top: y + height }
    : null;

  return (
    <section className="mode-panel focus-view" aria-labelledby="focus-title">
      <p className="eyebrow">Focus view · {asset.title}</p>
      <h3 id="focus-title">{heading}</h3>
      {imageUrl ? (
        // The reviewed description is the figure's caption, in the DOM, so a
        // screen reader's reading commands (VoiceOver VO+A, NVDA and JAWS
        // say-all, ChromeVox Search+R) reach it as ordinary text rather than
        // as an aria-label they cannot step through or reread. The outline is
        // decorative; the caption is the outline's meaning.
        <figure className="slide-figure">
          {/* Region bounds are fractions of the slide image, so the outline
              and pointer are positioned inside a frame holding only the image:
              measured against the whole figure they would also count the
              caption's height, and the scrim would dim the caption. */}
          <div className="slide-frame">
            <img className="slide-image" src={imageUrl} alt={asset.title} />
            <div
              className="region-highlight"
              aria-hidden="true"
              style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` }}
            />
            {pointerAt && (
              <svg
                className={`focus-pointer ${pointerAt.corner}`}
                viewBox="0 0 24 24"
                aria-hidden="true"
                style={{ left: `${pointerAt.left * 100}%`, top: `${pointerAt.top * 100}%` }}
              >
                <path d={pointerAt.corner === 'start' ? 'M22 22 L2 12 L11 10 L14 2 Z' : 'M2 2 L22 12 L13 14 L10 22 Z'} />
              </svg>
            )}
          </div>
          <figcaption className="supporting-text">{region.shortDescription}</figcaption>
        </figure>
      ) : (
        <p className="supporting-text">{region.shortDescription}</p>
      )}
      <p>{region.plainLanguage}</p>
    </section>
  );
}
