import type { AccessPack } from './contracts';

type Asset = AccessPack['assets'][number];

/**
 * Slide images bundled with the extension, keyed by pack id then by the
 * file name the pack's `mediaUri` points at. Packs live outside the
 * extension source tree, so Vite globs them here and emits hashed URLs.
 * Adding a pack means adding one glob line; nothing else in the student
 * experience knows where images come from.
 */
const bundledSlides: Record<string, Record<string, string>> = {
  'bio-cell-demo': byBasename(import.meta.glob('../../../../packages/access-packs/bio-cell-demo/slides/*.png', { eager: true, query: '?url', import: 'default' })),
  'hnsw-explainer': byBasename(import.meta.glob('../../../../packs/hnsw/slides/*.png', { eager: true, query: '?url', import: 'default' })),
};

function byBasename(globbed: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, url] of Object.entries(globbed)) out[basename(path)] = url as string;
  return out;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Bundled URL for an asset's slide image, or null when the pack ships none. */
export function slideImageUrl(pack: Pick<AccessPack, 'packId'>, asset: Pick<Asset, 'mediaUri'>): string | null {
  if (!asset.mediaUri) return null;
  return bundledSlides[pack.packId]?.[basename(asset.mediaUri)] ?? null;
}
