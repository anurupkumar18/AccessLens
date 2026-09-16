import type { ReviewedPack } from './packs.js';

export type SpeakField = 'shortDescription' | 'plainLanguage';

/**
 * The text Polly may speak: one field of one region of a reviewed pack, looked
 * up server-side. The route never accepts free text, so it cannot be used to
 * voice unreviewed or arbitrary sentences to a class (charter A3).
 */
export function reviewedText(pack: ReviewedPack, assetId: unknown, regionId: unknown, field: unknown): string | null {
  if (field !== 'shortDescription' && field !== 'plainLanguage') return null;
  const region = pack.assets.find(asset => asset.assetId === assetId)?.regions.find(candidate => candidate.regionId === regionId);
  return region ? region[field] : null;
}
