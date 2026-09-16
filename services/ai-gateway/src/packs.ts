import bioCellDemo from '../../../packages/access-packs/bio-cell-demo/pack.json' with { type: 'json' };

export interface PackRegion { regionId: string; label?: string; shortDescription: string; plainLanguage: string }
export interface PackAsset { assetId: string; title: string; subtitle?: string; regions: PackRegion[] }
export interface ReviewedPack { packId: string; version: number; title: string; review?: { status: string }; assets: PackAsset[] }

/**
 * The only material the AI routes may use: Access Packs that passed review.
 * Draft packs (machine-generated, unreviewed) are deliberately absent, so
 * neither an answer nor spoken audio can ever repeat an unreviewed sentence
 * (charter A3). Adding a pack here is a review decision, not a code change.
 */
const REVIEWED: ReviewedPack[] = [bioCellDemo as ReviewedPack];

export function reviewedPack(packId: unknown, version: unknown, packs: readonly ReviewedPack[] = REVIEWED): ReviewedPack | null {
  const pack = packs.find(candidate => candidate.packId === packId && candidate.version === version);
  if (!pack || !pack.review || pack.review.status === 'draft') return null;
  return pack;
}
