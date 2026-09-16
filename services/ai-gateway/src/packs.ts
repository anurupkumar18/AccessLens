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

/** Fetches `packs/<packId>/<version>.json` from the published distribution; resolves null when absent. */
export type PublishedPackFetch = (packId: string, version: number) => Promise<unknown>;

const PACK_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** A published pack in the shape the AI routes read, from an instructor review that is not a draft. */
function asReviewed(raw: unknown, packId: string, version: number): ReviewedPack | null {
  if (!raw || typeof raw !== 'object') return null;
  const pack = raw as Partial<ReviewedPack>;
  if (pack.packId !== packId || pack.version !== version || typeof pack.title !== 'string' || !Array.isArray(pack.assets)) return null;
  if (!pack.review || typeof pack.review.status !== 'string' || pack.review.status === 'draft') return null;
  const wellFormed = pack.assets.every(asset => asset && typeof asset.assetId === 'string' && typeof asset.title === 'string' && Array.isArray(asset.regions)
    && asset.regions.every(region => region && typeof region.regionId === 'string' && typeof region.shortDescription === 'string' && typeof region.plainLanguage === 'string'));
  return wellFormed ? (pack as ReviewedPack) : null;
}

/**
 * The bundled reviewed packs, then any pack the authoring pipeline published
 * after an instructor reviewed it (the same file students load). A published
 * pack still in draft is refused like a bundled one. Results are cached for the
 * life of the container, misses included, so a class cannot turn chat traffic
 * into distribution requests.
 */
export function createPackLoader(fetchPublished?: PublishedPackFetch): (packId: unknown, version: unknown) => Promise<ReviewedPack | null> {
  const cache = new Map<string, Promise<ReviewedPack | null>>();
  return async (packId, version) => {
    const bundled = reviewedPack(packId, version);
    if (bundled || !fetchPublished) return bundled;
    if (typeof packId !== 'string' || !PACK_ID.test(packId) || typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null;
    const key = `${packId}@${version}`;
    let loaded = cache.get(key);
    if (!loaded) {
      loaded = fetchPublished(packId, version).then(raw => asReviewed(raw, packId, version), () => null);
      cache.set(key, loaded);
    }
    return loaded;
  };
}
