import { describe, expect, it } from 'vitest';
import { cropToAspect, SLIDE_ASPECT } from './letterbox';
import { fingerprintFrame, hammingDistance } from './fingerprint';
import type { Frame } from './captureHost';
import { loadSlideFrame, solidFrame } from './fixtures';

/** Scale `slide` to fit inside a W×H frame and centre it on `bar`-coloured padding. */
function padToFrame(slide: Frame, width: number, height: number, bar = 0): Frame {
  const scale = Math.min(width / slide.width, height / slide.height);
  const w = Math.round(slide.width * scale);
  const h = Math.round(slide.height * scale);
  const ox = Math.floor((width - w) / 2);
  const oy = Math.floor((height - h) / 2);
  const out = solidFrame(width, height, bar);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(slide.width - 1, Math.floor(x / scale));
      const sy = Math.min(slide.height - 1, Math.floor(y / scale));
      const si = (sy * slide.width + sx) * 4;
      const di = ((y + oy) * width + (x + ox)) * 4;
      out.data.set(slide.data.subarray(si, si + 4), di);
    }
  }
  return out;
}

describe('cropToAspect', () => {
  it('returns a 16:9 frame untouched', () => {
    const frame = solidFrame(1920, 1080, 90);
    expect(cropToAspect(frame)).toBe(frame);
  });

  it('crops letterbox bars from a taller frame to the slide aspect', () => {
    const cropped = cropToAspect(solidFrame(1200, 900, 0));
    expect(cropped.width).toBe(1200);
    expect(cropped.height).toBe(675);
    expect(cropped.data.length).toBe(1200 * 675 * 4);
  });

  it('crops pillarbox bars from a wider frame to the slide aspect', () => {
    const cropped = cropToAspect(solidFrame(2560, 1080, 0));
    expect(cropped.width).toBe(1920);
    expect(cropped.height).toBe(1080);
  });

  it('takes the centred region', () => {
    const frame = solidFrame(100, 100, 0);
    // Paint rows 22..77 white: that is where a 16:9 slide sits when centred in a square.
    for (let y = 22; y < 78; y++) for (let x = 0; x < 100; x++) frame.data.fill(255, (y * 100 + x) * 4, (y * 100 + x) * 4 + 3);
    const cropped = cropToAspect(frame);
    expect(cropped.height).toBe(56);
    expect(Array.from(cropped.data).every((v, i) => i % 4 === 3 || v === 255)).toBe(true);
  });

  it('is a no-op for an empty frame', () => {
    const frame: Frame = { width: 0, height: 0, data: new Uint8ClampedArray(0) };
    expect(cropToAspect(frame)).toBe(frame);
  });
});

describe('letterboxed slides fingerprint like the original slide', () => {
  const slide = loadSlideFrame('slide-01');
  const reference = fingerprintFrame(slide);

  it.each([
    ['4:3 tab with side panel', 1200, 900],
    ['square viewport', 900, 900],
    ['ultrawide window', 2560, 1080],
  ])('%s', (_label, width, height) => {
    const shared = padToFrame(slide, width, height);
    const uncropped = hammingDistance(fingerprintFrame(shared), reference);
    const cropped = hammingDistance(fingerprintFrame(cropToAspect(shared, SLIDE_ASPECT)), reference);
    expect(cropped).toBeLessThanOrEqual(4);
    expect(cropped).toBeLessThan(uncropped);
  });
});
