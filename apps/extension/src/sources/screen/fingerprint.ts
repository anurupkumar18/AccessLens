import type { Frame } from './captureHost';

// Difference hash, "dhash-v1". The full contract is in README.md; the short
// version: Rec. 601 luminance, 9x8 area-averaged grid over the whole frame,
// 64 left-brighter-than-right bits, row-major, MSB first, 16 hex digits.

export const FINGERPRINT_PREFIX = 'dhash-v1:';
const FINGERPRINT_PATTERN = /^dhash-v1:[0-9a-f]{16}$/;
const COLUMNS = 9;
const ROWS = 8;

export function isFingerprint(value: string): boolean {
  return FINGERPRINT_PATTERN.test(value);
}

/** Mean Rec. 601 luminance of each cell in a 9-wide by 8-high grid. */
function luminanceGrid(frame: Frame): Float64Array {
  const { width, height, data } = frame;
  if (width <= 0 || height <= 0 || data.length !== width * height * 4) {
    throw new Error('Frame dimensions do not match its RGBA data');
  }
  const grid = new Float64Array(COLUMNS * ROWS);
  for (let row = 0; row < ROWS; row++) {
    const y0 = Math.floor((row * height) / ROWS);
    const y1 = Math.floor(((row + 1) * height) / ROWS);
    for (let col = 0; col < COLUMNS; col++) {
      const x0 = Math.floor((col * width) / COLUMNS);
      const x1 = Math.floor(((col + 1) * width) / COLUMNS);
      let sum = 0;
      for (let y = y0; y < y1; y++) {
        let offset = (y * width + x0) * 4;
        for (let x = x0; x < x1; x++) {
          sum += 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
          offset += 4;
        }
      }
      grid[row * COLUMNS + col] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return grid;
}

export function fingerprintFrame(frame: Frame): string {
  const grid = luminanceGrid(frame);
  let high = 0;
  let low = 0;
  let bitIndex = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLUMNS - 1; col++) {
      const bit = grid[row * COLUMNS + col] > grid[row * COLUMNS + col + 1] ? 1 : 0;
      if (bitIndex < 32) high = (high << 1) | bit;
      else low = (low << 1) | bit;
      bitIndex++;
    }
  }
  const hex = (high >>> 0).toString(16).padStart(8, '0') + (low >>> 0).toString(16).padStart(8, '0');
  return FINGERPRINT_PREFIX + hex;
}

function bits(fingerprint: string): [number, number] {
  if (!isFingerprint(fingerprint)) throw new Error(`Not a dhash-v1 fingerprint: ${fingerprint}`);
  const hex = fingerprint.slice(FINGERPRINT_PREFIX.length);
  return [parseInt(hex.slice(0, 8), 16) >>> 0, parseInt(hex.slice(8), 16) >>> 0];
}

function popcount(value: number): number {
  let v = value >>> 0;
  let count = 0;
  while (v !== 0) {
    v &= v - 1;
    count++;
  }
  return count;
}

/** Number of differing bits between two dhash-v1 fingerprints (0..64). */
export function hammingDistance(a: string, b: string): number {
  const [ah, al] = bits(a);
  const [bh, bl] = bits(b);
  return popcount(ah ^ bh) + popcount(al ^ bl);
}
