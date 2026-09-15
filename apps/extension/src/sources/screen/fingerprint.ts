import type { Frame } from './captureHost';

// Difference hash "dhash12": the fingerprint contract Part 5's reviewed pack
// defines in packages/access-packs/bio-cell-demo/tools/imagehash.py. This is
// a line-for-line port and is verified byte-for-byte against that pack's
// checked-in fingerprints in fingerprint.test.ts. Full contract in README.md.
//
// 12x12 grid of mean Rec. 601 luminance; 12 rows x 11 adjacent pairs = 132
// bits; bit = 1 only when the left cell is brighter than the right by more
// than TIE_EPSILON luminance levels, so flat areas resolve to 0 instead of a
// coin flip; row-major, MSB first, 33 lowercase hex digits.

export const FINGERPRINT_ALGORITHM = 'dhash12';
export const FINGERPRINT_PREFIX = `${FINGERPRINT_ALGORITHM}:`;
export const GRID = 12;
export const FINGERPRINT_BITS = GRID * (GRID - 1);
const HEX_DIGITS = Math.ceil(FINGERPRINT_BITS / 4);
export const TIE_EPSILON = 0.75;
const FINGERPRINT_PATTERN = new RegExp(`^${FINGERPRINT_ALGORITHM}:[0-9a-f]{${HEX_DIGITS}}$`);

export function isFingerprint(value: string): boolean {
  return FINGERPRINT_PATTERN.test(value);
}

/** Mean luminance of each cell in the GRID x GRID grid, in the reference implementation's cell assignment. */
function blockMeans(frame: Frame): Float64Array {
  const { width, height, data } = frame;
  if (width <= 0 || height <= 0 || data.length !== width * height * 4) {
    throw new Error('Frame dimensions do not match its RGBA data');
  }
  // Column edges by ceiling division: column c spans exactly the x with
  // floor(x * GRID / width) === c. Rows use the same floor assignment.
  const edges: number[] = [];
  for (let c = 0; c < GRID; c++) edges.push(Math.ceil((c * width) / GRID));
  edges.push(width);
  const totals = new Float64Array(GRID * GRID);
  const counts = new Float64Array(GRID * GRID);
  for (let y = 0; y < height; y++) {
    const cellY = Math.min(GRID - 1, Math.floor((y * GRID) / height));
    for (let c = 0; c < GRID; c++) {
      const left = edges[c];
      const right = edges[c + 1];
      if (right <= left) continue;
      let r = 0, g = 0, b = 0;
      let offset = (y * width + left) * 4;
      for (let x = left; x < right; x++) {
        r += data[offset]; g += data[offset + 1]; b += data[offset + 2];
        offset += 4;
      }
      const cell = cellY * GRID + c;
      totals[cell] += 0.299 * r + 0.587 * g + 0.114 * b;
      counts[cell] += right - left;
    }
  }
  const means = new Float64Array(GRID * GRID);
  for (let i = 0; i < means.length; i++) means[i] = totals[i] / counts[i];
  return means;
}

export function fingerprintFrame(frame: Frame): string {
  const means = blockMeans(frame);
  let bits = 0n;
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID - 1; col++) {
      bits <<= 1n;
      if (means[row * GRID + col] > means[row * GRID + col + 1] + TIE_EPSILON) bits |= 1n;
    }
  }
  return FINGERPRINT_PREFIX + bits.toString(16).padStart(HEX_DIGITS, '0');
}

function bits(fingerprint: string): bigint {
  if (!isFingerprint(fingerprint)) throw new Error(`Not a ${FINGERPRINT_ALGORITHM} fingerprint: ${fingerprint}`);
  return BigInt('0x' + fingerprint.slice(FINGERPRINT_PREFIX.length));
}

/** Number of differing bits between two fingerprints (0..132). */
export function hammingDistance(a: string, b: string): number {
  let x = bits(a) ^ bits(b);
  let count = 0;
  while (x !== 0n) {
    x &= x - 1n;
    count++;
  }
  return count;
}
