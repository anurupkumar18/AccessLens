// Fills dhash-v1 fingerprints into an AccessPack from a directory of slide
// PNGs named by assetId, then validates the result with AccessPackSchema.
//
// Usage: npx tsx scripts/fingerprint-pack.ts <pack.json> <slides-dir> [--out <path>]
// Without --out the pack file is rewritten in place. Output is 2-space JSON
// with a trailing newline, so re-running on unchanged slides is a no-op.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { AccessPackSchema } from '../apps/extension/src/shared/contracts';
import { fingerprintFrame } from '../apps/extension/src/sources/screen';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outPath = outIndex >= 0 ? args[outIndex + 1] : undefined;
const positional = outIndex >= 0 ? args.filter((_, i) => i !== outIndex && i !== outIndex + 1) : args;
const [packPath, slidesDir] = positional;
if (!packPath || !slidesDir || (outIndex >= 0 && !outPath)) {
  console.error('usage: fingerprint-pack.ts <pack.json> <slides-dir> [--out <path>]');
  process.exit(2);
}

const pack = JSON.parse(readFileSync(packPath, 'utf8')) as { assets: { assetId: string; fingerprint?: string }[] };
for (const asset of pack.assets) {
  const pngPath = join(slidesDir, `${asset.assetId}.png`);
  if (!existsSync(pngPath)) {
    console.error(`missing slide image for asset ${asset.assetId}: ${pngPath}`);
    process.exit(1);
  }
  const png = PNG.sync.read(readFileSync(pngPath));
  asset.fingerprint = fingerprintFrame({ width: png.width, height: png.height, data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length) });
  console.log(`${asset.assetId}\t${asset.fingerprint}`);
}
const validated = AccessPackSchema.parse(pack);
writeFileSync(outPath ?? packPath, JSON.stringify(validated, null, 2) + '\n');
