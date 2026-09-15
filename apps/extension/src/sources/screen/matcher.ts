import type { AccessPack } from '../../shared/contracts';
import { FINGERPRINT_ALGORITHM, hammingDistance, isFingerprint } from './fingerprint';

export interface MatchOptions {
  /** Maximum Hamming distance for a candidate to count as a match. */
  threshold: number;
  /** Every other asset must be at least this many bits farther away. */
  margin: number;
}

// Fallback when a pack carries no `matching` block. The values are Part 5's
// measured ceilings for the reviewed bio-cell-demo pack (deck.py:
// MATCH_MAX_HAMMING_DISTANCE / MATCH_MIN_MARGIN); README.md has the evidence.
export const DEFAULT_MATCH_OPTIONS: Readonly<MatchOptions> = Object.freeze({ threshold: 26, margin: 14 });

/** Thresholds are reviewed content: read them from the pack when present. */
export function matchOptionsFor(pack: AccessPack): MatchOptions {
  const m = pack.matching;
  if (!m) return { ...DEFAULT_MATCH_OPTIONS };
  if (m.algorithm !== FINGERPRINT_ALGORITHM) {
    throw new Error(`Pack ${pack.packId} uses fingerprint algorithm ${m.algorithm}; this build matches ${FINGERPRINT_ALGORITHM}`);
  }
  return { threshold: m.maxHammingDistance, margin: m.minMargin };
}

export type MatchDecision =
  | { kind: 'matched'; assetId: string; distance: number }
  | { kind: 'unmatched'; reason: 'no-candidate' | 'ambiguous' };

/**
 * Compares a frame fingerprint against every asset in the pack. A frame
 * matches asset X only when X is within the threshold and every other asset
 * is at least the ambiguity margin farther away. Anything else is unmatched:
 * the system never tells a student something it cannot prove.
 */
export function matchFingerprint(
  fingerprint: string,
  pack: AccessPack,
  options: MatchOptions = matchOptionsFor(pack),
): MatchDecision {
  let best: { assetId: string; distance: number } | null = null;
  let secondDistance = Infinity;
  for (const asset of pack.assets) {
    const distance = hammingDistance(fingerprint, asset.fingerprint);
    if (best === null || distance < best.distance) {
      if (best !== null) secondDistance = best.distance;
      best = { assetId: asset.assetId, distance };
    } else if (distance < secondDistance) {
      secondDistance = distance;
    }
  }
  if (best === null || best.distance > options.threshold) return { kind: 'unmatched', reason: 'no-candidate' };
  if (secondDistance - best.distance < options.margin) return { kind: 'unmatched', reason: 'ambiguous' };
  return { kind: 'matched', assetId: best.assetId, distance: best.distance };
}

/** Throws when any asset fingerprint is not a dhash12 string, or the pack names another algorithm. */
export function assertPackFingerprints(pack: AccessPack): void {
  matchOptionsFor(pack);
  for (const asset of pack.assets) {
    if (!isFingerprint(asset.fingerprint)) {
      throw new Error(`Asset ${asset.assetId} has a fingerprint that is not ${FINGERPRINT_ALGORITHM}; run scripts/fingerprint-pack.ts`);
    }
  }
}
