import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AccessPackSchema } from '../../shared/contracts';
import reviewedPackJson from '../../../../../packages/access-packs/bio-cell-demo/pack.json';
import hnswPackJson from '../../../../../packs/hnsw/pack.draft.json';
import { PNG } from 'pngjs';
import type { Frame } from './captureHost';
import { hammingDistance } from './fingerprint';
import { createSlideLocator } from './locate';
import { matchFingerprint, DEFAULT_MATCH_OPTIONS } from './matcher';
import { wholeFrameFingerprint } from './sampler';
import { loadSlideFrame, screenWith, slideInWindow, solidFrame } from './fixtures';

// The reviewed pack and its real slides: this is what an instructor presents.
const pack = AccessPackSchema.parse(reviewedPackJson);
const hnswPack = AccessPackSchema.parse(hnswPackJson);
const REPO = join(__dirname, '../../../../..');

function png(path: string): Frame {
  const image = PNG.sync.read(readFileSync(join(REPO, path)));
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
}
const reviewedSlide = (assetId: string) => png(`packages/access-packs/bio-cell-demo/slides/${assetId}.png`);
const matched = (fingerprint: string) => matchFingerprint(fingerprint, pack, DEFAULT_MATCH_OPTIONS);

/** Samples the same frame twice, as the sampler would while the screen holds still. */
function settle(locator: ReturnType<typeof createSlideLocator>, frame: Frame): string {
  locator.fingerprint(frame);
  return locator.fingerprint(frame);
}

describe('slide locator: window and screen shares', () => {
  it('leaves a frame that already matches alone, so a shared tab behaves exactly as before', () => {
    const slide = reviewedSlide('cell-slide-02');
    expect(createSlideLocator(pack, DEFAULT_MATCH_OPTIONS).fingerprint(slide)).toBe(wholeFrameFingerprint(slide));
  });

  it('finds every reviewed slide inside a viewer window whose toolbar and margins break the whole-frame match', () => {
    // The second slide in a window is the reproduced failure: 31 bits from
    // itself over the whole frame, past the 26-bit threshold.
    const broken = wholeFrameFingerprint(slideInWindow(reviewedSlide('cell-slide-02'), 900, 900));
    expect(matched(broken).kind).toBe('unmatched');

    for (const asset of pack.assets) {
      const frame = slideInWindow(reviewedSlide(asset.assetId), 900, 900);
      expect(matched(settle(createSlideLocator(pack, DEFAULT_MATCH_OPTIONS), frame))).toMatchObject({ kind: 'matched', assetId: asset.assetId });
    }
  });

  // The summed-area-table search over a full-screen frame for all five reviewed
  // slides comfortably clears Vitest's 5s default alone, but not reliably under
  // make check's full parallel worker load (40 files at once) -- reproduced
  // failing there twice in a row while passing in isolation every time.
  it('finds every reviewed slide in a window on a whole-screen share, among other content', () => {
    const wallpaper = loadSlideFrame('unknown-01');
    for (const asset of pack.assets) {
      const frame = screenWith(wallpaper, slideInWindow(reviewedSlide(asset.assetId), 760, 560), 24, 60);
      expect(hammingDistance(wholeFrameFingerprint(frame), asset.fingerprint)).toBeGreaterThan(DEFAULT_MATCH_OPTIONS.threshold);
      expect(matched(settle(createSlideLocator(pack, DEFAULT_MATCH_OPTIONS), frame))).toMatchObject({ kind: 'matched', assetId: asset.assetId });
    }
  }, 20000);

  it('does not report a freshly located slide until the next sample finds it again', () => {
    const frame = slideInWindow(reviewedSlide('cell-slide-02'), 900, 900);
    const locator = createSlideLocator(pack, DEFAULT_MATCH_OPTIONS);
    expect(matched(locator.fingerprint(frame)).kind).toBe('unmatched');
    expect(matched(locator.fingerprint(frame))).toMatchObject({ kind: 'matched', assetId: 'cell-slide-02' });
  });

  it('follows a slide change in the same window on the very next sample', () => {
    const locator = createSlideLocator(pack, DEFAULT_MATCH_OPTIONS);
    settle(locator, slideInWindow(reviewedSlide('cell-slide-01'), 1200, 780));
    expect(matched(locator.fingerprint(slideInWindow(reviewedSlide('cell-slide-05'), 1200, 780)))).toMatchObject({ kind: 'matched', assetId: 'cell-slide-05' });
  });

  it('never invents a match: empty screens, unknown content, and another deck all stay unmatched (charter A9)', () => {
    const photosynthesis = png('packages/access-packs/bio-cell-demo/demo-assets/unapproved-photosynthesis.png');
    const frames: Frame[] = [
      solidFrame(1440, 900, 30),
      solidFrame(1440, 900, 240),
      slideInWindow(photosynthesis, 1200, 780),
      screenWith(loadSlideFrame('unknown-01'), slideInWindow(photosynthesis, 760, 560), 24, 60),
      ...hnswPack.assets.map(asset => slideInWindow(png(`packs/hnsw/slides/${asset.assetId}.png`), 1200, 780)),
    ];
    for (const frame of frames) {
      expect(matched(settle(createSlideLocator(pack, DEFAULT_MATCH_OPTIONS), frame)).kind).toBe('unmatched');
    }
  });
});
