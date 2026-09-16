import React, { useEffect, useRef, useState } from 'react';
import type { AccessPack } from '../shared/contracts';

interface Props {
  pack: AccessPack;
  assetId?: string;
  regionId?: string;
  enabled: boolean;
}

/**
 * Tells the student's own screen reader (VoiceOver, NVDA, JAWS, ChromeVox,
 * Narrator) when the instructor moves to another slide or part of a slide, in
 * the reader's voice and at its speed, with nothing to press. A polite live
 * region, so it waits for whatever the reader is already saying. The words are
 * the pack's reviewed title and description, never anything generated live.
 */
export function ScreenReaderAnnouncer({ pack, assetId, regionId, enabled }: Props): React.ReactElement {
  const [announcement, setAnnouncement] = useState('');
  const previous = useRef<{ assetId?: string; regionId?: string }>({});

  useEffect(() => {
    const before = previous.current;
    previous.current = { assetId, regionId };
    if (!enabled || !assetId || (before.assetId === assetId && before.regionId === regionId)) return;
    const asset = pack.assets.find((candidate) => candidate.assetId === assetId);
    if (!asset) return;
    const region = regionId ? asset.regions.find((candidate) => candidate.regionId === regionId) : undefined;
    const slide = before.assetId !== assetId ? `Slide: ${asset.title}. ` : '';
    const focus = region ? `${region.label ?? region.regionId}: ${region.shortDescription}` : '';
    setAnnouncement(`${slide}${focus}`.trim());
  }, [pack, assetId, regionId, enabled]);

  return (
    <div className="visually-hidden" aria-live="polite" aria-atomic="true" data-testid="screen-reader-announcer">
      {enabled ? announcement : ''}
    </div>
  );
}
