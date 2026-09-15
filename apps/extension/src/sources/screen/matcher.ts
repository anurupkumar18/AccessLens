import type { AccessPack } from '../../shared/contracts';
import { hammingDistance, isFingerprint } from './fingerprint';

export interface MatchOptions {
  /** Maximum Hamming distance for a candidate to count as a match. */
  threshold: number;
  /** Every other asset must be at least this many bits farther away. */
  margin: number;
}

// Tuned from the fixture distance table in README.md. Change only with
// recorded evidence, never to make a failing fixture pass.
export const DEFAULT_MATCH_OPTIONS: Readonly<MatchOptions> = Object.freeze({ threshold: 10, margin: 4 });

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
  options: MatchOptions = DEFAULT_MATCH_OPTIONS,
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

/** Throws when any asset fingerprint is not a dhash-v1 string. */
export function assertPackFingerprints(pack: AccessPack): void {
  for (const asset of pack.assets) {
    if (!isFingerprint(asset.fingerprint)) {
      throw new Error(`Asset ${asset.assetId} has a fingerprint that is not dhash-v1; run scripts/fingerprint-pack.ts`);
    }
  }
}
