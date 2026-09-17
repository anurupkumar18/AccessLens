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
};

function byBasename(globbed: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, url] of Object.entries(globbed)) out[basename(path)] = url as string;
  return out;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Packs loaded from a published distribution (see remotePack.ts) resolve
 * their `mediaUri` against that distribution's root instead of the bundle.
 * Registration is keyed by pack id, the same key the bundled table uses, so
 * a remote pack shadows a bundled one of the same id for as long as it is
 * loaded -- which is the point when testing a pipeline build of a pack the
 * extension also ships.
 */
const remoteBases = new Map<string, URL>();

export function registerRemotePackBase(packId: string, base: URL): void {
  remoteBases.set(packId, base);
}

export function resetRemotePackBasesForTests(): void {
  remoteBases.clear();
}

/** URL for an asset's slide image: the published distribution's if the pack came from one, else the bundle's; null when the pack ships none. */
export function slideImageUrl(pack: Pick<AccessPack, 'packId'>, asset: Pick<Asset, 'mediaUri'>): string | null {
  if (!asset.mediaUri) return null;
  const remote = remoteBases.get(pack.packId);
  if (remote) return new URL(asset.mediaUri, remote).toString();
  return bundledSlides[pack.packId]?.[basename(asset.mediaUri)] ?? null;
}

