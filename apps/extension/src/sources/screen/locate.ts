import type { AccessPack } from '../../shared/contracts';
import type { Frame } from './captureHost';
import { fingerprintFrame, FINGERPRINT_PREFIX, GRID, TIE_EPSILON } from './fingerprint';
import { aspectRect, cropToAspect, SLIDE_ASPECT } from './letterbox';
import type { SlideRect } from './pointer';
import { matchFingerprint, type MatchOptions } from './matcher';

/**
 * Finding the slide inside a window or whole-screen share.
 *
 * The pack fingerprints cover the slide image and nothing else. A shared tab
 * (or a full-screen presentation) is exactly that, so the whole frame matches.
 * A shared window adds the viewer's toolbar and grey margins, and a shared
 * screen adds the menu bar, dock and every other window; the slide is then a
 * fraction of the frame and the whole-frame fingerprint drifts far past the
 * threshold (measured 31 and 47-55 bits against a limit of 26).
 *
 * So when the whole frame does not match, this searches the frame for a
 * slide-shaped rectangle whose fingerprint does. Block means over any
 * rectangle come from a summed-area table of luminance, so each candidate
 * costs 144 lookups instead of a pass over its pixels. The search is coarse
 * to fine: every scale at a one-cell step, then a quarter-cell step around
 * the best few. The winning rectangle is re-fingerprinted from the frame's own
 * pixels with `fingerprintFrame`, so the string handed on is exactly what the
 * matcher would compute for that crop.
 *
 * Searching many rectangles makes a chance near-match more likely than one
 * whole-frame comparison. Candidates are therefore ranked by how many of a
 * slide's set bits they share, not by Hamming distance (a flat patch of screen
 * hashes to mostly zeros, which is a short distance from a sparse slide), and a
 * located slide must also clear a stricter distance than the pack threshold,
 * keep the pack's margin, and have real contrast. A slide found by a fresh
 * search is only reported once the next sample finds the same slide, so a
 * chance match in moving content does not flash to students. The last
 * rectangle that matched is tried first on the next sample, so a window that
 * stays put costs one crop, not a search.
 *
 * Only window and whole-screen shares are searched (the controller decides); a
 * shared tab is the slide itself and keeps the whole-frame path.
 *
 * Geometry and luminance only. Frames stay inside this module and nothing but
 * a fingerprint string comes out (charter A2).
 */

/** Longest side of the luminance grid the search runs on. */
const WORK_WIDTH = 320;
/** A slide narrower than this fraction of the frame is not looked for. */
const MIN_WIDTH_FRACTION = 0.25;
/** Each smaller scale is this fraction of the previous one. */
const SCALE_STEP = 0.94;
/** Candidates carried from the coarse pass into refinement. */
const REFINE_COUNT = 8;
/** Located matches must be at least this much closer than the pack threshold. */
export const LOCATE_STRICTNESS = 0.75;
/**
 * Minimum overlap of set bits (intersection over union) between a located
 * rectangle and its slide. dhash12 turns flat areas into zeros, so an empty
 * patch of screen sits a small Hamming distance from a sparse slide while
 * sharing almost none of its set bits; the overlap is what tells them apart.
 */
export const MIN_OVERLAP = 0.6;
/** Standard deviation of the 144 block means, in luminance levels, below which a rectangle is too flat to be a slide. */
const MIN_CONTRAST = 8;

const WORDS = Math.ceil((GRID * (GRID - 1)) / 32);

interface Rect { x: number; y: number; w: number; h: number }
/** `rank` is 1 - overlap with the closest slide: lower is better. */
interface Scored extends Rect { rank: number }

/** Intersection over union of set bits. Two empty fingerprints overlap 0, not 1. */
function overlap(a: Uint32Array, b: Uint32Array): number {
  let both = 0;
  let either = 0;
  for (let i = 0; i < WORDS; i++) {
    both += popcount32((a[i] & b[i]) >>> 0);
    either += popcount32((a[i] | b[i]) >>> 0);
  }
  return either === 0 ? 0 : both / either;
}

function popcount32(v: number): number {
  v -= (v >>> 1) & 0x55555555;
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Fingerprint string to 32-bit words, most significant bit first, same order the hash is packed in. */
function toWords(fingerprint: string): Uint32Array {
  const bits = BigInt('0x' + fingerprint.slice(FINGERPRINT_PREFIX.length));
  const total = GRID * (GRID - 1);
  const words = new Uint32Array(WORDS);
  for (let i = 0; i < total; i++) {
    if ((bits >> BigInt(total - 1 - i)) & 1n) words[i >>> 5] |= 1 << (31 - (i & 31));
  }
  return words;
}

/** Box-averaged luminance at no more than WORK_WIDTH wide, plus its summed-area table. */
function luminanceTable(frame: Frame): { width: number; height: number; scale: number; sums: Float64Array } {
  const scale = Math.max(1, Math.ceil(frame.width / WORK_WIDTH));
  const width = Math.floor(frame.width / scale);
  const height = Math.floor(frame.height / scale);
  const sums = new Float64Array((width + 1) * (height + 1));
  const { data } = frame;
  const area = scale * scale;
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      let lum = 0;
      for (let dy = 0; dy < scale; dy++) {
        let offset = ((y * scale + dy) * frame.width + x * scale) * 4;
        for (let dx = 0; dx < scale; dx++) {
          lum += 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
          offset += 4;
        }
      }
      row += lum / area;
      sums[(y + 1) * (width + 1) + x + 1] = sums[y * (width + 1) + x + 1] + row;
    }
  }
  return { width, height, scale, sums };
}

const edgeCache = new Map<number, Int32Array>();

/** Cell edges in the fingerprint's own assignment: cell i starts at ceil(i * size / GRID). */
function edges(size: number): Int32Array {
  let out = edgeCache.get(size);
  if (!out) {
    out = new Int32Array(GRID + 1);
    for (let i = 0; i < GRID; i++) out[i] = Math.ceil((i * size) / GRID);
    out[GRID] = size;
    edgeCache.set(size, out);
  }
  return out;
}

export interface SlideLocator {
  /** Fingerprint of the slide in this frame: the whole frame when that matches, else the best located rectangle, else the whole frame. */
  fingerprint(frame: Frame): string;
  /** Where in the last frame the fingerprinted slide was, in frame pixels. Geometry only. */
  lastRect(): SlideRect | null;
}

export function createSlideLocator(pack: AccessPack, options: MatchOptions): SlideLocator {
  const assets = pack.assets.map(asset => toWords(asset.fingerprint));
  const strictThreshold = Math.floor(options.threshold * LOCATE_STRICTNESS);
  const means = new Float64Array(GRID * GRID);
  const words = new Uint32Array(WORDS);
  /** Last located rectangle as fractions of the frame, so a resize or rescale keeps it. */
  let remembered: { x: number; y: number; w: number; h: number } | null = null;
  /** Slide a fresh search found on the previous sample, awaiting confirmation. */
  let candidate: string | null = null;
  let last: SlideRect | null = null;

  /** 1 - the best set-bit overlap with any slide for a rectangle of the table, or null when it is too flat. */
  function score(table: ReturnType<typeof luminanceTable>, rect: Rect): number | null {
    const { sums, width } = table;
    const stride = width + 1;
    const cols = edges(rect.w);
    const rows = edges(rect.h);
    let total = 0;
    let squares = 0;
    for (let r = 0; r < GRID; r++) {
      const top = rect.y + rows[r];
      const bottom = rect.y + rows[r + 1];
      for (let c = 0; c < GRID; c++) {
        const left = rect.x + cols[c];
        const right = rect.x + cols[c + 1];
        const count = (bottom - top) * (right - left);
        const mean = count > 0
          ? (sums[bottom * stride + right] - sums[top * stride + right] - sums[bottom * stride + left] + sums[top * stride + left]) / count
          : 0;
        means[r * GRID + c] = mean;
        total += mean;
        squares += mean * mean;
      }
    }
    const cells = GRID * GRID;
    const variance = squares / cells - (total / cells) ** 2;
    if (variance < MIN_CONTRAST * MIN_CONTRAST) return null;

    words.fill(0);
    let bit = 0;
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID - 1; c++) {
        if (means[r * GRID + c] > means[r * GRID + c + 1] + TIE_EPSILON) words[bit >>> 5] |= 1 << (31 - (bit & 31));
        bit++;
      }
    }
    let best = 0;
    for (const asset of assets) best = Math.max(best, overlap(words, asset));
    return 1 - best;
  }

  function search(table: ReturnType<typeof luminanceTable>): Scored | null {
    const maxW = Math.min(table.width, Math.floor(table.height * SLIDE_ASPECT));
    const minW = Math.max(GRID * 4, Math.round(table.width * MIN_WIDTH_FRACTION));
    const top: Scored[] = [];
    const consider = (rect: Rect) => {
      const s = score(table, rect);
      if (s === null) return;
      if (top.length < REFINE_COUNT || s < top[top.length - 1].rank) {
        top.push({ ...rect, rank: s });
        top.sort((a, b) => a.rank - b.rank);
        if (top.length > REFINE_COUNT) top.pop();
      }
    };
    for (let w = maxW; w >= minW; w = Math.floor(w * SCALE_STEP)) {
      const h = Math.round(w / SLIDE_ASPECT);
      if (h > table.height) continue;
      const step = Math.max(1, Math.round(w / GRID));
      for (let y = 0; ; y = Math.min(y + step, table.height - h)) {
        for (let x = 0; ; x = Math.min(x + step, table.width - w)) {
          consider({ x, y, w, h });
          if (x === table.width - w) break;
        }
        if (y === table.height - h) break;
      }
    }

    let best: Scored | null = null;
    for (const coarse of top) {
      const step = Math.max(1, Math.round(coarse.w / (GRID * 4)));
      const reach = Math.max(1, Math.round(coarse.w / GRID));
      for (const factor of [0.97, 0.985, 1, 1.015, 1.03]) {
        const w = Math.round(coarse.w * factor);
        const h = Math.round(w / SLIDE_ASPECT);
        if (w > table.width || h > table.height || w < GRID) continue;
        for (let dy = -reach; dy <= reach; dy += step) {
          for (let dx = -reach; dx <= reach; dx += step) {
            const x = Math.min(Math.max(0, coarse.x + dx), table.width - w);
            const y = Math.min(Math.max(0, coarse.y + dy), table.height - h);
            const s = score(table, { x, y, w, h });
            if (s !== null && (!best || s < best.rank)) best = { x, y, w, h, rank: s };
          }
        }
      }
    }
    return best;
  }

  /** The frame's own pixels under a rectangle of the table, re-fingerprinted exactly. */
  function cropFingerprint(frame: Frame, scale: number, rect: Rect): string {
    const x0 = rect.x * scale;
    const y0 = rect.y * scale;
    const w = Math.min(rect.w * scale, frame.width - x0);
    const h = Math.min(rect.h * scale, frame.height - y0);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const start = ((y0 + y) * frame.width + x0) * 4;
      data.set(frame.data.subarray(start, start + w * 4), y * w * 4);
    }
    return fingerprintFrame({ width: w, height: h, data });
  }

  /** A located crop must match under the stricter threshold and share most of its slide's set bits. */
  /** The slide a located crop matches under the stricter rules, or null. */
  function accepts(fingerprint: string): string | null {
    const decision = matchFingerprint(fingerprint, pack, { threshold: strictThreshold, margin: options.margin });
    if (decision.kind !== 'matched') return null;
    const slide = assets[pack.assets.findIndex(asset => asset.assetId === decision.assetId)];
    return overlap(toWords(fingerprint), slide) >= MIN_OVERLAP ? decision.assetId : null;
  }

  /** The frame-pixel rectangle under a rectangle of the table, clipped to the frame as `cropFingerprint` clips it. */
  function frameRect(frame: Frame, scale: number, rect: Rect): SlideRect {
    const x = rect.x * scale;
    const y = rect.y * scale;
    return { x, y, width: Math.min(rect.w * scale, frame.width - x), height: Math.min(rect.h * scale, frame.height - y) };
  }

  return {
    lastRect: () => last,
    fingerprint(frame) {
      const whole = fingerprintFrame(cropToAspect(frame));
      last = aspectRect(frame.width, frame.height);
      if (matchFingerprint(whole, pack, options).kind === 'matched' || frame.width === 0 || frame.height === 0) {
        remembered = null;
        candidate = null;
        return whole;
      }
      const table = luminanceTable(frame);
      if (table.width < GRID || table.height < GRID) return whole;

      if (remembered) {
        const rect = {
          x: Math.round(remembered.x * table.width),
          y: Math.round(remembered.y * table.height),
          w: Math.round(remembered.w * table.width),
          h: Math.round(remembered.h * table.height),
        };
        if (rect.x + rect.w <= table.width && rect.y + rect.h <= table.height && score(table, rect) !== null) {
          const fingerprint = cropFingerprint(frame, table.scale, rect);
          if (accepts(fingerprint)) {
            last = frameRect(frame, table.scale, rect);
            return fingerprint;
          }
        }
        remembered = null;
      }

      const found = search(table);
      if (found && 1 - found.rank >= MIN_OVERLAP) {
        const fingerprint = cropFingerprint(frame, table.scale, found);
        const assetId = accepts(fingerprint);
        if (assetId !== null) {
          const confirmed = candidate === assetId;
          candidate = assetId;
          if (confirmed) {
            candidate = null;
            remembered = { x: found.x / table.width, y: found.y / table.height, w: found.w / table.width, h: found.h / table.height };
            last = frameRect(frame, table.scale, found);
            return fingerprint;
          }
          return whole;
        }
      }
      candidate = null;
      return whole;
    },
  };
}
