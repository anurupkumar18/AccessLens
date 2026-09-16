import { describe, expect, it } from 'vitest';
import { audioEvent, crc32, decodeMessage, encodeMessage, transcriptFrom } from './eventStream';
import { downsampleToPcm16 } from './pcm';
import { spokenRegion } from './spokenRegion';
import { SpeechSegmenter } from './segmenter';
import { encodeWav } from './wav';
import { startWhisperCaptions } from './whisperStream';
import { AiUnavailableError } from '../../shared/aiClient';

const encode = (text: string) => new TextEncoder().encode(text);

/** `ms` of 16 kHz PCM16: a tone at `amplitude`, or silence at 0. */
function pcm(ms: number, amplitude: number): Uint8Array {
  const samples = Math.round((16000 * ms) / 1000);
  const view = new DataView(new ArrayBuffer(samples * 2));
  for (let i = 0; i < samples; i++) view.setInt16(i * 2, Math.round(amplitude * Math.sin(i / 5)), true);
  return new Uint8Array(view.buffer);
}
const seconds = (clip: Uint8Array) => clip.length / 2 / 16000;

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

describe('SpeechSegmenter', () => {
  it('cuts one clip at the pause after speech, keeping a little audio from before it', () => {
    const segmenter = new SpeechSegmenter({ sampleRate: 16000 });
    expect(segmenter.push(pcm(500, 0))).toEqual([]);
    expect(segmenter.push(pcm(1200, 4000))).toEqual([]);
    const clips = segmenter.push(pcm(700, 0));
    expect(clips).toHaveLength(1);
    // 240 ms pre-roll + 1200 ms speech + the 600 ms pause that ended it.
    expect(seconds(clips[0]!)).toBeCloseTo(2.04, 1);
  });

  it('drops silence and short noises, so they are never sent', () => {
    const segmenter = new SpeechSegmenter({ sampleRate: 16000 });
    expect(segmenter.push(pcm(3000, 0))).toEqual([]);
    expect(segmenter.push(pcm(90, 6000))).toEqual([]); // a click
    expect(segmenter.push(pcm(1000, 0))).toEqual([]);
    expect(segmenter.flush()).toBeNull();
  });

  it('splits long unbroken speech so captions keep coming, and flushes the clip in progress', () => {
    const segmenter = new SpeechSegmenter({ sampleRate: 16000, maxClipMs: 3000 });
    const clips = segmenter.push(pcm(7000, 4000));
    expect(clips.map(seconds)).toEqual([3, 3]);
    expect(seconds(segmenter.flush()!)).toBeCloseTo(1, 1);
  });

  it('handles audio arriving in odd-sized chunks the same as all at once', () => {
    const whole = new SpeechSegmenter({ sampleRate: 16000 }).push(new Uint8Array([...pcm(1000, 4000), ...pcm(700, 0)]));
    const chunked = new SpeechSegmenter({ sampleRate: 16000 });
    const audio = new Uint8Array([...pcm(1000, 4000), ...pcm(700, 0)]);
    const pieces: Uint8Array[] = [];
    for (let i = 0; i < audio.length; i += 1361) pieces.push(...chunked.push(audio.subarray(i, i + 1361)));
    expect(pieces.map(seconds)).toEqual(whole.map(seconds));
  });
});

describe('encodeWav', () => {
  it('writes a 16 kHz mono 16-bit RIFF header in front of the samples', () => {
    const wav = encodeWav(new Uint8Array([1, 0, 255, 255]), 16000);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.subarray(0, 4), ...wav.subarray(8, 12))).toBe('RIFFWAVE');
    expect([view.getUint16(22, true), view.getUint32(24, true), view.getUint16(34, true), view.getUint32(40, true)]).toEqual([1, 16000, 16, 4]);
    expect([...wav.subarray(44)]).toEqual([1, 0, 255, 255]);
  });
});

describe('startWhisperCaptions', () => {
  function harness(transcribe: (wav: Uint8Array) => Promise<string>) {
    let feed: ((pcm16: Uint8Array) => void) | null = null;
    const micStopped = { value: false };
    const pieces: string[] = [];
    const errors: string[] = [];
    let closed = 0;
    const started = startWhisperCaptions(
      { media: {} as MediaStream, transcribe, onPiece: p => pieces.push(`${p.text}${p.isFinal ? '' : '…'}`), onError: m => errors.push(m), onClosed: () => { closed += 1; } },
      async (_media, _rate, onPcm) => { feed = onPcm; return { stop: () => { micStopped.value = true; } }; },
    );
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    return { started, pieces, errors, micStopped, closed: () => closed, speak: (ms: number) => { feed!(pcm(ms, 4000)); feed!(pcm(700, 0)); }, settle };
  }

  it('sends each spoken clip as WAV and reports the texts as finals in speaking order', async () => {
    const deferred = () => { let resolve!: (text: string) => void; const promise = new Promise<string>(r => { resolve = r; }); return { promise, resolve }; };
    const replies = [deferred(), deferred()];
    const sent: Uint8Array[] = [];
    const h = harness(wav => { sent.push(wav); return replies[sent.length - 1]!.promise; });
    await h.started;
    h.speak(800);
    h.speak(600);
    expect(sent.map(wav => String.fromCharCode(...wav.subarray(0, 4)))).toEqual(['RIFF', 'RIFF']);
    replies[1]!.resolve('and the nucleolus.');
    await h.settle();
    expect(h.pieces).toEqual([]);
    replies[0]!.resolve('Now look at the nucleus');
    await h.settle();
    expect(h.pieces).toEqual(['Now look at the nucleus', 'and the nucleolus.']);
  });

  it('stops and says so when Whisper is not running', async () => {
    const h = harness(async () => { throw new AiUnavailableError(503, 'The AI service answered 503.'); });
    const stream = await h.started;
    h.speak(800);
    await h.settle();
    expect(h.errors[0]).toMatch(/Whisper is not running/);
    expect(h.micStopped.value).toBe(true);
    expect(h.closed()).toBe(1);
    stream.stop();
    expect(h.closed()).toBe(1);
  });

  it('keeps captioning after a single failed clip, and reports nothing after stop', async () => {
    let calls = 0;
    const h = harness(async () => { calls += 1; if (calls === 1) throw new AiUnavailableError(500, 'boom'); return 'Second phrase.'; });
    const stream = await h.started;
    h.speak(800);
    h.speak(800);
    await h.settle();
    expect(h.errors).toEqual(['One stretch of speech could not be captioned.']);
    expect(h.pieces).toEqual(['Second phrase.']);
    stream.stop();
    h.speak(800);
    await h.settle();
    expect(calls).toBe(2);
  });
});
