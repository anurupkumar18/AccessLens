/**
 * Derive the relay's pack index from Part 5's reviewed pack.
 *
 * The relay needs to answer three questions -- does this asset exist, does this
 * region belong to it, does this hotspot match that region -- and nothing else.
 * It does not need `shortDescription`, `plainLanguage`, captions, fingerprints,
 * or any other student-facing prose.
 *
 * So it does not get them. This strips the pack down to identifiers before it
 * is bundled into the Lambda, which means the relay is structurally incapable
 * of logging lesson content: the content is not in the deployment artifact at
 * all. `log.ts` enforces the same rule for events; this enforces it for the
 * pack.
 *
 * Run via `npm run build:pack` in services/live-session. The output,
 * `src/pack.json`, is generated and git-ignored -- `pack.json` in
 * `packages/access-packs/bio-cell-demo/` is the source of truth, and a stale
 * copy checked in here would be a second one.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const source = join(repoRoot, 'packages/access-packs/bio-cell-demo/pack.json');
const target = join(here, '../src/pack.json');

const pack = JSON.parse(readFileSync(source, 'utf8'));

const index = {
  packId: pack.packId,
  version: pack.version,
  assets: pack.assets.map(asset => ({
    assetId: asset.assetId,
    regions: asset.regions.map(region => ({ regionId: region.regionId })),
    ...(asset.arScene
      ? {
          arScene: {
            hotspots: (asset.arScene.hotspots ?? []).map(hotspot => ({
              hotspotId: hotspot.hotspotId,
              regionId: hotspot.regionId,
            })),
          },
        }
      : {}),
  })),
};

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(index, null, 2)}\n`, 'utf8');

const regions = index.assets.reduce((n, a) => n + a.regions.length, 0);
const hotspots = index.assets.reduce((n, a) => n + (a.arScene?.hotspots.length ?? 0), 0);
console.log(
  `pack index: ${index.packId} v${index.version} — ${index.assets.length} assets, ` +
    `${regions} regions, ${hotspots} hotspots`,
);
