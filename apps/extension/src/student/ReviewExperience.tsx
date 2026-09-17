import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { AccessPack } from '../shared/contracts';
import type { StudentPreferences } from '../shared/preferences';
import { FocusView } from '../renderers/FocusView';
import { StructuredTextView } from '../renderers/StructuredTextView';
import { loadReviewBookmarks, saveReviewBookmarks } from './reviewBookmarks';
import { loadReviewProgress, saveReviewProgress } from './reviewProgress';

const CellArView = React.lazy(async () => {
  const module = await import('../ar/CellArView');
  return { default: module.CellArView };
});

type ReviewMode = 'focus' | 'read' | 'ar';

interface Props {
  pack: AccessPack;
  preferences: StudentPreferences;
}

interface Concept {
  id: string;
  assetId: string;
  regionId: string;
  label: string;
  hasAr: boolean;
  hotspotId?: string;
}

/** A local, self-paced reference built from an already reviewed Access Pack.
 * It deliberately consumes no live event or session history. */
export function ReviewExperience({ pack, preferences }: Props): React.ReactElement {
  const concepts = useMemo<Concept[]>(() => pack.assets.flatMap((asset) => asset.regions.map((region) => {
    const hotspot = asset.arScene?.hotspots.find((candidate) => candidate.regionId === region.regionId);
    return {
      id: `${asset.assetId}:${region.regionId}`,
      assetId: asset.assetId,
      regionId: region.regionId,
      label: region.label ?? region.regionId,
      hasAr: hotspot !== undefined,
      hotspotId: hotspot?.hotspotId,
    };
  })), [pack]);
  const [index, setIndex] = useState(0);
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [explored, setExplored] = useState<string[]>([]);
  const [mode, setMode] = useState<ReviewMode>('read');
  const progressChangedLocally = useRef(false);

  useEffect(() => { setIndex(0); }, [pack.packId, pack.version]);
  useEffect(() => { void loadReviewBookmarks(pack.packId).then(setBookmarks).catch(() => setBookmarks([])); }, [pack.packId]);
  useEffect(() => {
    progressChangedLocally.current = false;
    void loadReviewProgress(pack.packId).then((stored) => {
      if (!progressChangedLocally.current) setExplored(stored);
    }).catch(() => {
      if (!progressChangedLocally.current) setExplored([]);
    });
  }, [pack.packId]);

  if (concepts.length === 0) {
    return <section className="review-experience" aria-labelledby="review-title"><h2 id="review-title">Review mode</h2><p role="status">This pack has no reviewed concepts to review yet.</p></section>;
  }

  const concept = concepts[index]!;
  const bookmarked = bookmarks.includes(concept.id);
  const markedExplored = explored.includes(concept.id);
  const availableModes: Array<{ id: ReviewMode; label: string }> = [
    { id: 'read', label: 'Read' }, { id: 'focus', label: 'Focus' },
    ...(concept.hasAr ? [{ id: 'ar' as const, label: 'AR' }] : []),
  ];
  const activeMode = availableModes.some((candidate) => candidate.id === mode) ? mode : 'read';
  const panelId = `review-panel-${activeMode}`;

  function moveMode(currentIndex: number, key: string): void {
    let nextIndex = currentIndex;
    if (key === 'ArrowRight') nextIndex = (currentIndex + 1) % availableModes.length;
    else if (key === 'ArrowLeft') nextIndex = (currentIndex - 1 + availableModes.length) % availableModes.length;
    else if (key === 'Home') nextIndex = 0;
    else if (key === 'End') nextIndex = availableModes.length - 1;
    else return;
    const nextMode = availableModes[nextIndex]!.id;
    setMode(nextMode);
    window.setTimeout(() => document.querySelector<HTMLElement>(`#review-mode-tab-${nextMode}`)?.focus(), 0);
  }

  function toggleBookmark(): void {
    const next = bookmarked ? bookmarks.filter((id) => id !== concept.id) : [...bookmarks, concept.id];
    setBookmarks(next);
    void saveReviewBookmarks(pack.packId, next);
  }

  function toggleExplored(): void {
    const next = markedExplored ? explored.filter((id) => id !== concept.id) : [...explored, concept.id];
    progressChangedLocally.current = true;
    setExplored(next);
    void saveReviewProgress(pack.packId, next);
  }

  return (
    <section className={`review-experience font-${preferences.fontFamily} spacing-${preferences.lineSpacing}${preferences.highContrast ? ' high-contrast' : ''}`} aria-labelledby="review-title" style={{ fontSize: `${preferences.textScale}rem` }}>
      <p className="eyebrow">Self-paced reviewed reference</p>
      <h2 id="review-title">Review mode</h2>
      <p className="review-not-live" role="status">Not live. This page uses reviewed pack content, not a class recording or live session history.</p>
      <div className="review-controls">
        <button type="button" onClick={() => setIndex((current) => Math.max(0, current - 1))} disabled={index === 0}>Previous concept</button>
        <span aria-live="polite">Concept {index + 1} of {concepts.length}: {concept.label}</span>
        <button type="button" onClick={() => setIndex((current) => Math.min(concepts.length - 1, current + 1))} disabled={index === concepts.length - 1}>Next concept</button>
      </div>
      <button type="button" className="bookmark-button" aria-pressed={bookmarked} onClick={toggleBookmark}>{bookmarked ? 'Remove bookmark' : 'Bookmark for later'}</button>
      <p className="supporting-text" role="status">{bookmarks.length} local bookmark{bookmarks.length === 1 ? '' : 's'} in this pack.</p>
      <div className="review-progress" aria-label="Private review progress">
        <button type="button" aria-pressed={markedExplored} onClick={toggleExplored}>{markedExplored ? 'Mark not explored' : 'Mark explored'}</button>
        <p role="status">{explored.length} of {concepts.length} concepts marked explored on this device. This is private and not a grade.</p>
      </div>
      <div className="mode-tabs" role="tablist" aria-label="Choose a review format">
        {availableModes.map((candidate, index) => <button key={candidate.id} id={`review-mode-tab-${candidate.id}`} type="button" role="tab" aria-selected={activeMode === candidate.id} aria-controls={panelId} tabIndex={activeMode === candidate.id ? 0 : -1} onClick={() => setMode(candidate.id)} onKeyDown={(event) => moveMode(index, event.key)}>{candidate.label}</button>)}
      </div>
      <div className="student-content review-content" id={panelId} role="tabpanel" aria-labelledby={`review-mode-tab-${activeMode}`} tabIndex={0}>
        {activeMode === 'focus' ? <FocusView pack={pack} assetId={concept.assetId} regionId={concept.regionId} /> : null}
        {activeMode === 'read' ? <StructuredTextView pack={pack} /> : null}
        {activeMode === 'ar' && concept.hotspotId ? <Suspense fallback={<p role="status">Loading the reviewed AR scene…</p>}><CellArView regionId={concept.regionId} hotspotId={concept.hotspotId} reducedMotion={preferences.reducedMotion} /></Suspense> : null}
      </div>
    </section>
  );
}
