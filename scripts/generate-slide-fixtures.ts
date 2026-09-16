// Deterministic synthetic slide generator for the Part 2 screen-source tests.
// Usage: npx tsx scripts/generate-slide-fixtures.ts
// Writes apps/extension/src/sources/screen/fixtures/slides/*.png and demo/*.png.
// Every pixel is a pure function of the layout tables below and a seeded PRNG,
// so re-running produces byte-identical files.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'apps/extension/src/sources/screen/fixtures/slides');
const W = 1920;
const H = 1080;

type Rgb = [number, number, number];
type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: Rgb }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; color: Rgb }
  | { kind: 'stripes'; x: number; y: number; w: number; h: number; lines: number; color: Rgb };

interface Layout { name: string; band: Rgb; shapes: Shape[] }

const NAVY: Rgb = [24, 40, 88];
const GREEN: Rgb = [30, 110, 60];
const RUST: Rgb = [140, 50, 30];
const PLUM: Rgb = [90, 40, 110];
const TEAL: Rgb = [20, 100, 120];
const INK: Rgb = [40, 40, 48];
const GOLD: Rgb = [200, 150, 30];

// All coordinates are normalized 0..1 of the 1920x1080 canvas. Region bounds
// in fixtures/test-pack.json are copied from these tables.
//
// The dhash grid is 9 columns by 8 rows. Bit (row, col) is 1 when cell `col`
// is brighter than cell `col + 1`; with the left-bright background wash that
// means a bit is 0 exactly where cell `col` holds dark content. So each slide
// is designed as a fill mask over a 4-column by 2-row macro grid of the body
// (each macro cell is two hash columns by three or four hash rows), using the
// eight codewords of the (8,4) extended Hamming code so that any two layouts
// differ in at least four macro cells, i.e. roughly 24 or more hash bits.
// Macro columns: x in [0, .222), [.222, .444), [.444, .667), [.667, .889).
// Macro rows: y in [.125, .5) (top) and [.5, 1) (bottom). Column 8 is margin.
const LAYOUTS: Layout[] = [
  // 1100 / 1100: left half
  { name: 'slide-01', band: NAVY, shapes: [
    { kind: 'ellipse', cx: 0.20, cy: 0.58, rx: 0.27, ry: 0.52, color: GREEN },
  ] },
  // 0011 / 0011: right half
  { name: 'slide-02', band: RUST, shapes: [
    { kind: 'stripes', x: 0.45, y: 0.14, w: 0.44, h: 0.35, lines: 6, color: INK },
    { kind: 'rect', x: 0.45, y: 0.52, w: 0.44, h: 0.44, color: TEAL },
  ] },
  // 1111 / 0000: top half
  { name: 'slide-03', band: GREEN, shapes: [
    { kind: 'rect', x: 0.02, y: 0.13, w: 0.87, h: 0.37, color: RUST },
  ] },
  // 0000 / 1111: bottom half
  { name: 'slide-04', band: PLUM, shapes: [
    { kind: 'ellipse', cx: 0.444, cy: 0.80, rx: 0.52, ry: 0.34, color: NAVY },
    { kind: 'ellipse', cx: 0.444, cy: 0.80, rx: 0.16, ry: 0.12, color: GOLD },
  ] },
  // 1001 / 0110: outer top, inner bottom
  { name: 'slide-05', band: TEAL, shapes: [
    { kind: 'stripes', x: 0.02, y: 0.14, w: 0.20, h: 0.35, lines: 5, color: INK },
    { kind: 'rect', x: 0.67, y: 0.13, w: 0.22, h: 0.37, color: GOLD },
    { kind: 'rect', x: 0.23, y: 0.52, w: 0.44, h: 0.46, color: PLUM },
  ] },
  // 0110 / 1001: inner top, outer bottom
  { name: 'slide-06', band: INK, shapes: [
    { kind: 'rect', x: 0.23, y: 0.13, w: 0.44, h: 0.37, color: NAVY },
    { kind: 'stripes', x: 0.02, y: 0.53, w: 0.20, h: 0.44, lines: 6, color: INK },
    { kind: 'rect', x: 0.67, y: 0.52, w: 0.22, h: 0.46, color: GREEN },
  ] },
  // 1010 / 0101: checkerboard
  { name: 'unknown-01', band: GOLD, shapes: [
    { kind: 'rect', x: 0.02, y: 0.13, w: 0.20, h: 0.37, color: PLUM },
    { kind: 'stripes', x: 0.45, y: 0.14, w: 0.22, h: 0.35, lines: 5, color: INK },
    { kind: 'rect', x: 0.23, y: 0.52, w: 0.22, h: 0.46, color: RUST },
    { kind: 'rect', x: 0.67, y: 0.52, w: 0.22, h: 0.46, color: TEAL },
  ] },
  // 0101 / 1010: the other checkerboard; twin-b adds one 24 px box
  { name: 'twin-a', band: RUST, shapes: [
    { kind: 'rect', x: 0.23, y: 0.13, w: 0.22, h: 0.37, color: NAVY },
    { kind: 'stripes', x: 0.67, y: 0.14, w: 0.22, h: 0.35, lines: 5, color: INK },
    { kind: 'rect', x: 0.02, y: 0.52, w: 0.20, h: 0.46, color: GREEN },
    { kind: 'rect', x: 0.45, y: 0.52, w: 0.22, h: 0.46, color: PLUM },
  ] },
  { name: 'twin-b', band: RUST, shapes: [
    { kind: 'rect', x: 0.23, y: 0.13, w: 0.22, h: 0.37, color: NAVY },
    { kind: 'stripes', x: 0.67, y: 0.14, w: 0.22, h: 0.35, lines: 5, color: INK },
    { kind: 'rect', x: 0.02, y: 0.52, w: 0.20, h: 0.46, color: GREEN },
    { kind: 'rect', x: 0.45, y: 0.52, w: 0.22, h: 0.46, color: PLUM },
    // The only difference: a 24x24 px slide-number box in the bottom-right.
    { kind: 'rect', x: 1860 / W, y: 1030 / H, w: 24 / W, h: 24 / H, color: INK },
  ] },
];

/** Background wash: light on the left, darker on the right, so flat regions have a deterministic left>right ordering. */
function background(x: number): Rgb {
  const t = x / (W - 1);
  const v = Math.round(238 - 72 * t);
  return [v, v, Math.min(255, v + 6)];
}

function paint(layout: Layout): PNG {
  const png = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let color = background(x);
      if (y < 0.11 * H) color = layout.band;
      if (y >= 0.035 * H && y < 0.075 * H && x >= 0.06 * W && x < 0.06 * W + 0.30 * W) color = [235, 235, 235];
      for (const s of layout.shapes) {
        if (s.kind === 'rect') {
          if (x >= s.x * W && x < (s.x + s.w) * W && y >= s.y * H && y < (s.y + s.h) * H) color = s.color;
        } else if (s.kind === 'ellipse') {
          const dx = (x - s.cx * W) / (s.rx * W);
          const dy = (y - s.cy * H) / (s.ry * H);
          if (dx * dx + dy * dy <= 1) color = s.color;
        } else {
          if (x >= s.x * W && x < (s.x + s.w) * W && y >= s.y * H && y < (s.y + s.h) * H) {
            const lineHeight = (s.h * H) / s.lines;
            const within = (y - s.y * H) % lineHeight;
            const lineWidth = s.w * W * (0.86 + 0.14 * ((((y - s.y * H) / lineHeight) | 0) % 3) / 2);
            if (within < lineHeight * 0.55 && x < s.x * W + lineWidth) color = s.color;
          }
        }
      }
      const i = (y * W + x) * 4;
      png.data[i] = color[0]; png.data[i + 1] = color[1]; png.data[i + 2] = color[2]; png.data[i + 3] = 255;
    }
  }
  return png;
}

/** mulberry32: small deterministic PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Demo conditions: 1280x720 area rescale, +10 brightness, a 4 px dark bezel,
 * and deterministic noise shaped like video compression: one +-5 offset per
 * 8x8 block plus +-2 per pixel. Block noise is what a shared window actually
 * looks like after encoding, and it compresses far better than white noise.
 */
function demoVariant(src: PNG, seed: number): PNG {
  const DW = 1280;
  const DH = 720;
  const out = new PNG({ width: DW, height: DH });
  const random = prng(seed);
  const PIXEL_NOISE = 1;
  const BLOCK_NOISE = 5;
  const BRIGHTNESS = 10;
  const BEZEL = 4;
  const blockRandom = prng(seed * 7919);
  const blocks = new Float64Array(Math.ceil(DW / 8) * Math.ceil(DH / 8));
  for (let i = 0; i < blocks.length; i++) blocks[i] = (blockRandom() * 2 - 1) * BLOCK_NOISE;
  for (let y = 0; y < DH; y++) {
    const sy0 = Math.floor((y * H) / DH);
    const sy1 = Math.floor(((y + 1) * H) / DH);
    for (let x = 0; x < DW; x++) {
      const sx0 = Math.floor((x * W) / DW);
      const sx1 = Math.floor(((x + 1) * W) / DW);
      const acc = [0, 0, 0];
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) {
        const i = (sy * W + sx) * 4;
        acc[0] += src.data[i]; acc[1] += src.data[i + 1]; acc[2] += src.data[i + 2];
        n++;
      }
      const o = (y * DW + x) * 4;
      const bezel = x < BEZEL || y < BEZEL || x >= DW - BEZEL || y >= DH - BEZEL;
      const noise = blocks[(y >> 3) * Math.ceil(DW / 8) + (x >> 3)] + Math.round((random() * 2 - 1) * PIXEL_NOISE);
      for (let c = 0; c < 3; c++) {
        let v = bezel ? 24 : acc[c] / n + BRIGHTNESS + noise;
        v = Math.max(0, Math.min(255, Math.round(v)));
        out.data[o + c] = v;
      }
      out.data[o + 3] = 255;
    }
  }
  return out;
}

mkdirSync(join(OUT, 'demo'), { recursive: true });
LAYOUTS.forEach((layout, index) => {
  const png = paint(layout);
  writeFileSync(join(OUT, `${layout.name}.png`), PNG.sync.write(png, { deflateLevel: 9 }));
  if (layout.name.startsWith('slide-')) {
    writeFileSync(join(OUT, 'demo', `${layout.name}.png`), PNG.sync.write(demoVariant(png, 1000 + index), { deflateLevel: 9 }));
  }
  console.log(`wrote ${layout.name}`);
});
