import { describe, expect, it } from 'vitest';
import { resample } from './microphone';
import { SAMPLE_RATE_HZ, UtteranceSegmenter } from './segmenter';

const ms = (n: number) => Math.round((SAMPLE_RATE_HZ * n) / 1000);
const silence = (duration: number) => new Float32Array(ms(duration)).fill(0.001);
const speech = (duration: number) => Float32Array.from({ length: ms(duration) }, (_, i) => 0.3 * Math.sin(i / 5));

function run(chunks: Float32Array[], options = {}) {
  const out: Float32Array[] = [];
  const segmenter = new UtteranceSegmenter(u => out.push(u), options);
  // Deliver in odd-sized pieces, as ScriptProcessorNode does.
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 4096) segmenter.push(chunk.subarray(i, i + 4096));
  }
  return { out, segmenter };
}

describe('UtteranceSegmenter', () => {
  it('emits one utterance per pause-separated sentence', () => {
    const { out } = run([silence(500), speech(1200), silence(900), speech(800), silence(900)]);
    expect(out).toHaveLength(2);
  });

  it('keeps the preroll so the first syllable is not clipped, and trims most trailing silence', () => {
    const { out } = run([silence(500), speech(1000), silence(900)]);
    const seconds = out[0].length / SAMPLE_RATE_HZ;
    expect(seconds).toBeGreaterThanOrEqual(1.2);
    expect(seconds).toBeLessThan(1.5);
  });

  it('ignores clicks shorter than the minimum speech length', () => {
    const { out } = run([silence(500), speech(100), silence(900)]);
    expect(out).toHaveLength(0);
  });

  it('cuts an unbroken explanation at the cap so captions keep flowing', () => {
    const { out } = run([silence(300), speech(20000)]);
    expect(out.length).toBeGreaterThanOrEqual(3);
    for (const u of out) expect(u.length).toBeLessThanOrEqual(ms(5000));
  });

  it('cuts continuous speech in the gap between words, not mid-word, and loses nothing', () => {
    // 380 ms words with 220 ms gaps: a speaker who never pauses long enough.
    const chunks: Float32Array[] = [silence(300)];
    for (let i = 0; i < 20; i++) chunks.push(speech(380), silence(220));
    const { out, segmenter } = run(chunks);
    segmenter.flush();
    expect(out.length).toBeGreaterThanOrEqual(2);
    for (const u of out.slice(0, -1)) {
      // The last 20 ms of every cut utterance is inside a gap.
      const tail = u.subarray(u.length - ms(20));
      expect(Math.max(...Array.from(tail, Math.abs))).toBeLessThan(0.01);
    }
    const total = out.reduce((sum, u) => sum + u.length, 0);
    expect(total).toBeGreaterThanOrEqual(ms(20 * 600 - 220));
  });

  it('flush emits speech still in progress, and nothing when idle', () => {
    const { out, segmenter } = run([silence(300), speech(1000)]);
    expect(out).toHaveLength(0);
    segmenter.flush();
    expect(out).toHaveLength(1);
    segmenter.flush();
    expect(out).toHaveLength(1);
  });

  it('does not treat a steady noisy room as speech once it has learned the floor', () => {
    const noise = () => Float32Array.from({ length: ms(3000) }, () => (Math.random() - 0.5) * 0.02);
    const { out } = run([noise(), noise(), silence(900)]);
    expect(out).toHaveLength(0);
  });
});

describe('resample', () => {
  it('is a no-op at the target rate and shortens higher-rate input proportionally', () => {
    const input = new Float32Array(48000).fill(0.5);
    expect(resample(input, 16000)).toBe(input);
    const out = resample(input, 48000);
    expect(out.length).toBe(16000);
    expect(out[100]).toBeCloseTo(0.5);
  });
});
