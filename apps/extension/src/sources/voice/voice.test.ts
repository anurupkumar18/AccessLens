import { describe, expect, it } from 'vitest';
import { audioEvent, crc32, decodeMessage, encodeMessage, transcriptFrom } from './eventStream';
import { downsampleToPcm16 } from './pcm';
import { spokenRegion } from './spokenRegion';

const encode = (text: string) => new TextEncoder().encode(text);

describe('event-stream framing', () => {
  it('computes the standard CRC32 check value', () => {
    expect(crc32(encode('123456789'))).toBe(0xcbf43926);
  });

  it('frames an AudioEvent that decodes back to the same headers and PCM bytes', () => {
    const pcm = new Uint8Array([1, 2, 3, 4]);
    const message = decodeMessage(audioEvent(pcm));
    expect(message.headers).toEqual({ ':content-type': 'application/octet-stream', ':event-type': 'AudioEvent', ':message-type': 'event' });
    expect([...message.payload]).toEqual([1, 2, 3, 4]);
  });

  it('refuses a corrupted message instead of reading garbage', () => {
    const bytes = audioEvent(new Uint8Array([9, 9]));
    bytes[bytes.length - 6] ^= 0xff;
    expect(() => decodeMessage(bytes)).toThrow(/checksum/);
  });

  it('reads partial and final transcript results and ignores empty ones', () => {
    const body = { Transcript: { Results: [
      { IsPartial: true, Alternatives: [{ Transcript: 'now look at the' }] },
      { IsPartial: false, Alternatives: [{ Transcript: 'Now look at the nucleus.' }] },
      { IsPartial: false, Alternatives: [{ Transcript: '  ' }] },
    ] } };
    const message = decodeMessage(encodeMessage({ ':message-type': 'event', ':event-type': 'TranscriptEvent', ':content-type': 'application/json' }, encode(JSON.stringify(body))));
    expect(transcriptFrom(message)).toEqual([
      { text: 'now look at the', isFinal: false },
      { text: 'Now look at the nucleus.', isFinal: true },
    ]);
  });

  it('turns a Transcribe exception into an error with its message', () => {
    const message = decodeMessage(encodeMessage({ ':message-type': 'exception', ':exception-type': 'BadRequestException' }, encode(JSON.stringify({ Message: 'Your stream is too big' }))));
    expect(() => transcriptFrom(message)).toThrow('BadRequestException: Your stream is too big');
  });
});

describe('downsampleToPcm16', () => {
  it('turns 48 kHz float samples into a third as many 16-bit little-endian samples', () => {
    const input = new Float32Array(4800).fill(0.5);
    const pcm = downsampleToPcm16(input, 48000);
    expect(pcm.length).toBe(1600 * 2);
    expect(new DataView(pcm.buffer).getInt16(0, true)).toBe(Math.floor(0.5 * 0x7fff));
  });

  it('clamps out-of-range samples and refuses to upsample', () => {
    const pcm = downsampleToPcm16(new Float32Array([-3, -3, -3]), 48000);
    expect(new DataView(pcm.buffer).getInt16(0, true)).toBe(-0x8000);
    expect(() => downsampleToPcm16(new Float32Array(10), 8000)).toThrow(/upsample/);
  });
});

describe('spokenRegion', () => {
  const slideOne = [{ regionId: 'cell-membrane', label: 'Cell membrane' }, { regionId: 'cytoplasm', label: 'Cytoplasm' }, { regionId: 'nucleus', label: 'Nucleus' }];
  const slideTwo = [{ regionId: 'nucleus', label: 'Nucleus' }, { regionId: 'nucleolus', label: 'Nucleolus' }];
  const slideFour = [{ regionId: 'ribosome', label: 'Ribosome' }, { regionId: 'rough-er', label: 'Rough endoplasmic reticulum' }, { regionId: 'golgi-apparatus', label: 'Golgi apparatus' }];

  it('finds a named region, including plurals and multi-word names', () => {
    expect(spokenRegion('Now look at the nucleus here.', slideOne)).toBe('nucleus');
    expect(spokenRegion('The cell membrane controls what gets in.', slideOne)).toBe('cell-membrane');
    expect(spokenRegion('Ribosomes build proteins.', slideFour)).toBe('ribosome');
    expect(spokenRegion('then the endoplasmic reticulum folds them', slideFour)).toBe('rough-er');
  });

  it('prefers the closer spelling when two names share a stem', () => {
    expect(spokenRegion('inside the nucleolus', slideTwo)).toBe('nucleolus');
    expect(spokenRegion('the nucleus holds DNA', slideTwo)).toBe('nucleus');
  });

  it('takes the last region mentioned', () => {
    expect(spokenRegion('from the nucleus out through the cytoplasm', slideOne)).toBe('cytoplasm');
  });

  it('returns null when no reviewed region is named, rather than guessing', () => {
    expect(spokenRegion('Any questions so far?', slideOne)).toBeNull();
    expect(spokenRegion('a cell is small', slideOne)).toBeNull();
    expect(spokenRegion('', slideOne)).toBeNull();
  });
});
