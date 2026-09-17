import { describe, expect, it } from 'vitest';
import { bytesToBase64, toPcm16Base64 } from './pcm';

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
