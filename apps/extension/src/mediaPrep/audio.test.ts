import { describe, expect, it } from 'vitest';
import { bytesToBase64, chunkBoundaries, toPcm16Base64 } from './audio';

const RATE = 100;

/** Loud everywhere except a silent stretch at each given second. */
function tone(seconds: number, silentAt: number[]): Float32Array {
  const samples = new Float32Array(seconds * RATE).fill(0.5);
  for (const at of silentAt) samples.fill(0, at * RATE, at * RATE + RATE / 5);
  return samples;
}

describe('chunkBoundaries', () => {
  it('returns one chunk for audio shorter than the target', () => {
    expect(chunkBoundaries(tone(30, []), RATE, 55)).toEqual([0, 3000]);
  });

  it('cuts inside the quietest stretch before each target', () => {
    const boundaries = chunkBoundaries(tone(130, [50, 100]), RATE, 55);
    expect(boundaries[0]).toBe(0);
    expect(boundaries.at(-1)).toBe(13000);
    expect(boundaries[1]).toBeGreaterThanOrEqual(5000);
    expect(boundaries[1]).toBeLessThan(5020);
    expect(boundaries[2]).toBeGreaterThanOrEqual(10000);
    expect(boundaries[2]).toBeLessThan(10020);
  });

  it('always makes progress and covers every sample', () => {
    const boundaries = chunkBoundaries(tone(400, []), RATE, 55);
    for (let i = 1; i < boundaries.length; i++) {
      expect(boundaries[i]).toBeGreaterThan(boundaries[i - 1]);
      expect(boundaries[i] - boundaries[i - 1]).toBeLessThanOrEqual(55 * RATE);
    }
    expect(boundaries.at(-1)).toBe(40000);
  });
});

describe('pcm16 encoding', () => {
  it('writes clamped little-endian samples', () => {
    const bytes = Uint8Array.from(atob(toPcm16Base64(new Float32Array([0, 1, -1, 2]))), c => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    expect([0, 1, 2, 3].map(i => view.getInt16(i * 2, true))).toEqual([0, 32767, -32768, 32767]);
  });

  it('base64-encodes buffers larger than one String.fromCharCode batch', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
});
