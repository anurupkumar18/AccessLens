import type { AccessPack } from '../shared/contracts';

type Asset = AccessPack['assets'][number];
export type Region = Asset['regions'][number];

/** One slide with its regions in the pack's reading order; regions the order omits follow at the end. */
export interface OutlineSlide { asset: Asset; regions: Region[] }

/**
 * The whole lesson as the student browses it: every slide, every region,
 * in reading order. Read, Hear and Dyslexic modes render this and let the
 * student move through it at their own pace; only Focus follows the
 * instructor's live position.
 */
export function packOutline(pack: AccessPack): OutlineSlide[] {
  return pack.assets.map((asset) => {
    const byId = new Map(asset.regions.map((region) => [region.regionId, region]));
    const ordered = asset.readingOrder.flatMap((regionId) => {
      const region = byId.get(regionId);
      if (!region) return [];
      byId.delete(regionId);
      return [region];
    });
    return { asset, regions: [...ordered, ...byId.values()] };
  });
}

export function regionName(region: Region): string {
  return region.label ?? region.regionId;
}
