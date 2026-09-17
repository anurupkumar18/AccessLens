import type { Frame } from './captureHost';

/**
 * Finds the instructor's mouse pointer on the recognised slide, on this device.
 *
 * A window or whole-screen share includes the mouse pointer in its frames, so
 * the pointer is whatever moves across a slide that otherwise holds still. The
 * tracker keeps a background of the slide: each cell's last value that stayed
 * the same across two samples. The pointer is the strongest difference from
 * that background. A pointer that rested long enough to become background
 * leaves a second spot behind when it moves; the pointer is then whichever
 * spot just changed, or, when both or neither did, the one it moved to or the
 * one it stayed at.
 *
 * Measured on the HNSW deck rendered full screen with a Retina-sized arrow,
 * captured at 1280 wide: 160/160 pointer positions within 3% of the slide
 * diagonal, and no detections on 16 pointer-free frames.
 *
 * Only a normalised position comes out, and the controller turns that into a
 * reviewed region before anything is sent: the relay learns which reviewed part
 * of the slide the instructor is pointing at, never where the mouse is
 * (charter A2).
 */

export interface SlideRect { x: number; y: number; width: number; height: number }
export interface PointerPosition { x: number; y: number }

export interface PointerTracker {
  /** The pointer's position on the slide (0-1 on each axis), or null when nothing moved. */
  observe(frame: Frame, slide: SlideRect): PointerPosition | null;
  reset(): void;
}

const GRID_W = 192;
const GRID_H = 108;
/** Luminance change below which a cell counts as unchanged between two samples. */
const STABLE_LEVEL = 2;
/** Summed difference over a 3x3 neighbourhood that counts as a pointer. */
const PEAK_MIN = 120;
/** Cells apart two peaks must be to count as separate spots. */
const PEAK_SEPARATION = 6;
/** A cell differing by more than this counts towards a content change. */
const CHANGED_LEVEL = 30;
/** More changed cells than this fraction is the slide itself changing (an animation, a scroll), not a pointer. */
const MAX_CHANGED_FRACTION = 0.01;
/** The arrow's tip sits up and to the left of its middle, which is where the difference peaks. */
const TIP_OFFSET = { x: 1, y: 2 };

export function createPointerTracker(): PointerTracker {
  let previous: Float32Array | null = null;
  let background: Float32Array | null = null;
  let lastSlide: SlideRect | null = null;
  let last: PointerPosition | null = null;

  function reset(): void {
    previous = null;
    background = null;
    lastSlide = null;
    last = null;
  }

  return {
    reset,
    observe(frame, slide) {
      if (lastSlide && (Math.abs(lastSlide.x - slide.x) > 2 || Math.abs(lastSlide.y - slide.y) > 2
        || Math.abs(lastSlide.width - slide.width) > 2 || Math.abs(lastSlide.height - slide.height) > 2)) {
        reset();
      }
      lastSlide = slide;
      const grid = luminanceGrid(frame, slide);
      if (!previous || !background) {
        previous = grid;
        background = new Float32Array(grid);
        return null;
      }

      const difference = new Float32Array(grid.length);
      let changed = 0;
      for (let i = 0; i < grid.length; i++) {
        difference[i] = Math.abs(grid[i] - background[i]);
        if (difference[i] > CHANGED_LEVEL) changed++;
      }
      if (changed > grid.length * MAX_CHANGED_FRACTION) {
        background.set(grid);
        previous = grid;
        last = null;
        return null;
      }

      const peaks = strongestPeaks(difference);
      let pick: { x: number; y: number } | null = peaks[0] ?? null;
      if (peaks.length === 2 && last) {
        // Two spots differ from the background: where the pointer is and where it
        // rested before. If both just changed, it moved this sample: the new spot is
        // the one away from its last position. If neither did, it has come to rest:
        // it is still where it was. If only one did, that one is the pointer.
        const from = last;
        const distance = (p: { x: number; y: number }) => Math.hypot((p.x + 0.5) / GRID_W - from.x, (p.y + 0.5) / GRID_H - from.y);
        const moved = peaks.map(p => neighbourhood(grid, previous!, p) >= PEAK_MIN);
        if (moved[0] !== moved[1]) pick = moved[0] ? peaks[0] : peaks[1];
        else if (moved[0]) pick = distance(peaks[0]) >= distance(peaks[1]) ? peaks[0] : peaks[1];
        else pick = distance(peaks[0]) <= distance(peaks[1]) ? peaks[0] : peaks[1];
      }

      for (let i = 0; i < grid.length; i++) {
        if (Math.abs(grid[i] - previous[i]) < STABLE_LEVEL) background[i] = grid[i];
      }
      previous = grid;

      if (!pick) return null;
      last = { x: (pick.x + 0.5) / GRID_W, y: (pick.y + 0.5) / GRID_H };
      return {
        x: Math.max(0, Math.min(1, (pick.x - TIP_OFFSET.x + 0.5) / GRID_W)),
        y: Math.max(0, Math.min(1, (pick.y - TIP_OFFSET.y + 0.5) / GRID_H)),
      };
    },
  };
}

/** Box-averaged luminance of the slide rectangle on a GRID_W x GRID_H grid, sampling every other pixel. */
function luminanceGrid(frame: Frame, slide: SlideRect): Float32Array {
  const out = new Float32Array(GRID_W * GRID_H);
  const x0 = Math.max(0, Math.round(slide.x));
  const y0 = Math.max(0, Math.round(slide.y));
  const width = Math.min(Math.round(slide.width), frame.width - x0);
  const height = Math.min(Math.round(slide.height), frame.height - y0);
  if (width <= 0 || height <= 0) return out;
  for (let gy = 0; gy < GRID_H; gy++) {
    const top = y0 + Math.floor((gy * height) / GRID_H);
    const bottom = Math.max(top + 1, y0 + Math.floor(((gy + 1) * height) / GRID_H));
    for (let gx = 0; gx < GRID_W; gx++) {
      const left = x0 + Math.floor((gx * width) / GRID_W);
      const right = Math.max(left + 1, x0 + Math.floor(((gx + 1) * width) / GRID_W));
      let sum = 0;
      let count = 0;
      for (let y = top; y < bottom; y += 2) {
        let offset = (y * frame.width + left) * 4;
        for (let x = left; x < right; x += 2) {
          sum += 0.299 * frame.data[offset] + 0.587 * frame.data[offset + 1] + 0.114 * frame.data[offset + 2];
          offset += 8;
          count++;
        }
      }
      out[gy * GRID_W + gx] = count > 0 ? sum / count : 0;
    }
  }
  return out;
}

/** Summed absolute difference between two grids over the 3x3 neighbourhood of a cell. */
function neighbourhood(a: Float32Array, b: Float32Array, cell: { x: number; y: number }): number {
  let sum = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const i = (cell.y + dy) * GRID_W + cell.x + dx;
      sum += Math.abs(a[i] - b[i]);
    }
  }
  return sum;
}

/** Up to two separated 3x3 neighbourhoods whose summed difference clears PEAK_MIN, strongest first. */
function strongestPeaks(difference: Float32Array): Array<{ x: number; y: number }> {
  const peaks: Array<{ x: number; y: number }> = [];
  for (let pass = 0; pass < 2; pass++) {
    let best = 0;
    let bestX = -1;
    let bestY = -1;
    for (let y = 1; y < GRID_H - 1; y++) {
      for (let x = 1; x < GRID_W - 1; x++) {
        if (peaks.some(p => Math.abs(p.x - x) < PEAK_SEPARATION && Math.abs(p.y - y) < PEAK_SEPARATION)) continue;
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const row = (y + dy) * GRID_W;
          sum += difference[row + x - 1] + difference[row + x] + difference[row + x + 1];
        }
        if (sum > best) { best = sum; bestX = x; bestY = y; }
      }
    }
    if (best < PEAK_MIN) break;
    peaks.push({ x: bestX, y: bestY });
  }
  return peaks;
}
