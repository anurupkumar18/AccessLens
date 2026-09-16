import { AccessPackSchema, type AccessPack } from './contracts';
import { registerRemotePackBase } from './packMedia';

/**
 * A pack published by the authoring pipeline (Part 6) lives at
 * `packs/<packId>/<version>.json` behind CloudFront, next to the media it
 * references. Opening the shell with `?pack=<that url>` renders it with the
 * same student renderers the bundled packs use. This is how the pipeline's
 * output is checked against the real UI (decision D7); it is not a student
 * distribution path, which is still the live session's `packId`/`packVersion`.
 *
 * The pack is validated with the same schema as the bundled ones, so a
 * malformed published pack is refused here rather than rendered wrongly.
 */
export function remotePackUrl(search: string): URL | null {
  const raw = new URLSearchParams(search).get('pack');
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // Only https: a pack fetched over plain http could be swapped in transit,
  // and a file: or chrome-extension: URL is not a published pack.
  // A same-machine dev server (`npx vite` with its /packs and /media proxy)
  // is the one plain-http origin allowed, so a published pack can be viewed
  // locally without CORS headers on the distribution.
  const local = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  return url.protocol === 'https:' || local ? url : null;
}

export async function loadRemotePack(url: URL, fetchImpl: typeof fetch = fetch): Promise<AccessPack> {
  const response = await fetchImpl(url.toString(), { credentials: 'omit' });
  if (!response.ok) throw new Error(`pack fetch failed: HTTP ${response.status} for ${url}`);
  const pack = AccessPackSchema.parse(await response.json());
  // Media in a published pack is relative to the distribution root
  // (`media/<packId>/<version>/slide-01.png`), not to the pack file.
  registerRemotePackBase(pack.packId, new URL('/', url));
  return pack;
}

/**
 * Where a session's pack lives once the authoring pipeline has published it:
 * `packs/<packId>/<version>.json` under the asset distribution. The live
 * session's events name the pack by id and version, so a student who joins
 * with a code can fetch exactly the pack the instructor is teaching, with no
 * bundled copy and no URL to paste. The base is the deployed distribution
 * (`VITE_ACCESSLENS_ASSET_BASE_URL`); a local host with no configured base
 * falls back to its own origin, where the dev server proxies `/packs`.
 */
export function publishedPackUrl(packId: string, version: number, base: string = publishedPackBase()): URL {
  return new URL(`packs/${encodeURIComponent(packId)}/${version}.json`, base.endsWith('/') ? base : `${base}/`);
}

function publishedPackBase(): string {
  const configured = (import.meta.env.VITE_ACCESSLENS_ASSET_BASE_URL as string | undefined)?.trim();
  return configured || window.location.origin;
}

export function fetchPublishedPack(packId: string, version: number): Promise<AccessPack> {
  return loadRemotePack(publishedPackUrl(packId, version));
}
