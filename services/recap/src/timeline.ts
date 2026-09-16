/**
 * The pure core of the catch-up service: timeline in, plain-text outline out.
 *
 * Split from `handler.ts` for the same reason `records.ts` is split from
 * `store.ts` in the relay -- nothing in this file imports `@aws-sdk`, so the
 * part of the service that is actually hard to get right (what the student is
 * told they missed) is provable on a laptop with no credentials, no network and
 * no model. The handler above it is then only glue.
 *
 * The event shapes are declared locally rather than imported from
 * `packages/contracts`, which ships a JSON Schema and no TypeScript module.
 * These interfaces are deliberately loose supersets of the frozen
 * `LiveEventSchema`: a recap must not fail because a newer relay added a field.
 */

/** A live event as it arrives from the relay. Widened on purpose -- see above. */
export interface LiveEvent {
  type?: string;
  sequence?: number;
  assetId?: string;
  regionId?: string;
  [key: string]: unknown;
}

export interface PackRegion {
  regionId: string;
  label?: string;
  shortDescription?: string;
}

export interface PackAsset {
  assetId: string;
  title?: string;
  regions?: PackRegion[];
}

/**
 * The reviewed material the ids resolve against. Optional everywhere: a recap
 * with no pack is degraded, not broken.
 */
export interface RecapPack {
  title?: string;
  assets?: PackAsset[];
}

/**
 * The two event types that move the lesson forward. Everything else --
 * `session.started`, `pointer.moved`, `source.unmatched` -- either carries no
 * content by schema or describes the capture rig rather than the lesson, and
 * reporting it to a student who looked away is noise.
 */
const TIMELINE_TYPES = new Set(['asset.changed', 'region.changed']);

/**
 * Said when an id is not in the pack. Phrased as a fact about the pack rather
 * than as a label, so the model is told there is no information here instead of
 * being handed a raw slug that reads like one.
 */
const UNDESCRIBED = '(not described in the lesson pack)';

export interface Coverage {
  /** Sequence of the first event in the recap window. */
  fromSequence: number;
  /** Sequence of the last event in the recap window. */
  toSequence: number;
  /**
   * How many region changes the student missed. The UI uses this to say
   * "4 things happened" before the text loads.
   */
  regionCount: number;
}

const sequenceOf = (event: LiveEvent): number =>
  typeof event.sequence === 'number' && Number.isFinite(event.sequence) ? event.sequence : 0;

const stringOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

/**
 * The events this recap is about: lesson-moving types, after `sinceSequence`,
 * in sequence order.
 *
 * Sorting here rather than trusting the caller is not defensive padding. The
 * relay guarantees ordered *delivery*, but a client that reconnected mid-class
 * stitches its buffer together from a replay and a live tail, and that stitch is
 * exactly where order breaks. A recap that lists the slides out of order is
 * worse than no recap, because it is confidently wrong.
 */
export function selectTimeline(events: readonly LiveEvent[], sinceSequence?: number): LiveEvent[] {
  const floor =
    typeof sinceSequence === 'number' && Number.isFinite(sinceSequence)
      ? sinceSequence
      : Number.NEGATIVE_INFINITY;

  return events
    .filter(event => TIMELINE_TYPES.has(String(event.type)) && sequenceOf(event) > floor)
    .sort((a, b) => sequenceOf(a) - sequenceOf(b));
}

/**
 * What the recap covers, as numbers the caller can show without reading the text.
 *
 * Reported even when the window is empty, so the client always has a cursor to
 * pass as the next request's `sinceSequence` and never re-asks for a window it
 * has already seen.
 */
export function coverage(events: readonly LiveEvent[], sinceSequence?: number): Coverage {
  const window = selectTimeline(events, sinceSequence);
  const base =
    typeof sinceSequence === 'number' && Number.isFinite(sinceSequence) ? sinceSequence : 0;

  const first = window[0];
  const last = window[window.length - 1];

  return {
    fromSequence: first ? sequenceOf(first) : base,
    toSequence: last ? sequenceOf(last) : base,
    regionCount: window.filter(event => event.type === 'region.changed').length,
  };
}

interface PackIndex {
  assets: Map<string, PackAsset>;
  /**
   * Keyed `assetId regionId`. Region ids repeat across slides -- `nucleus`
   * appears on two of the demo pack's four -- so a flat region map would resolve
   * the wrong description whenever a region is reused with different wording.
   */
  regions: Map<string, PackRegion>;
}

function indexPack(pack?: RecapPack): PackIndex {
  const assets = new Map<string, PackAsset>();
  const regions = new Map<string, PackRegion>();

  for (const asset of pack?.assets ?? []) {
    if (!asset || typeof asset.assetId !== 'string') continue;
    assets.set(asset.assetId, asset);
    for (const region of asset.regions ?? []) {
      if (!region || typeof region.regionId !== 'string') continue;
      regions.set(`${asset.assetId} ${region.regionId}`, region);
    }
  }

  return { assets, regions };
}

/**
 * Fold a window of the live timeline into a plain-text outline for the model.
 *
 * Pure: same inputs, same string, no clock, no network, no logging. Returns the
 * empty string when nothing lesson-moving happened, which is the handler's
 * signal to answer without spending a model call.
 *
 * The output format avoids `-`, `*` and `#` deliberately. The model is told not
 * to emit markdown because a screen reader reads the punctuation aloud, and the
 * single most likely way it emits markdown anyway is by mirroring the shape of
 * its own input.
 */
export function summariseTimeline(
  events: readonly LiveEvent[],
  pack?: RecapPack,
  sinceSequence?: number,
): string {
  const window = selectTimeline(events, sinceSequence);
  if (window.length === 0) return '';

  const index = indexPack(pack);
  const lines: string[] = [];

  const packTitle = stringOf(pack?.title);
  if (packTitle) lines.push(`Lesson: ${packTitle}`);

  let openAsset: string | undefined;
  let lastRegionKey: string | undefined;

  /**
   * Open a slide heading.
   *
   * Driven by whichever event names the asset, not only by `asset.changed`. A
   * recap window almost always starts mid-slide -- the student looked away after
   * the slide went up, not before it -- so the first event in the window is
   * usually a `region.changed`, and without this the outline would describe
   * highlighted regions with no statement of what they are on.
   */
  const openSlide = (assetId: string): void => {
    if (assetId === openAsset) return;
    openAsset = assetId;
    lastRegionKey = undefined;
    const asset = index.assets.get(assetId);
    const title = stringOf(asset?.title);
    lines.push(`Slide: ${title ?? `${assetId} ${UNDESCRIBED}`}`);
  };

  for (const event of window) {
    const assetId = stringOf(event.assetId);
    if (assetId) openSlide(assetId);

    if (event.type !== 'region.changed') continue;

    const regionId = stringOf(event.regionId);
    // A `region.changed` with no `regionId` is malformed under the frozen
    // schema, but arriving here it is just a beat with nothing to say. Dropping
    // it silently is right: the alternative is a line of outline saying
    // something was highlighted without saying what, which invites a guess.
    if (!regionId) continue;

    const key = `${assetId ?? ''} ${regionId}`;
    // The instructor lingering on one region emits repeats. The student missed
    // one thing, not six.
    if (key === lastRegionKey) continue;
    lastRegionKey = key;

    const region = assetId ? index.regions.get(key) : undefined;
    const label = stringOf(region?.label);
    const description = stringOf(region?.shortDescription);

    if (!label && !description) {
      lines.push(`  Highlighted: ${regionId} ${UNDESCRIBED}`);
      continue;
    }
    lines.push(`  Highlighted: ${label ?? regionId}.${description ? ` ${description}` : ''}`);
  }

  return lines.join('\n');
}
