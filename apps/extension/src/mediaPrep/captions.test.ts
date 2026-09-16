import { describe, expect, it } from 'vitest';
import { buildCues, formatTimestamp, MAX_LINE_CHARS, toTranscript, toWebVtt, wrapCue, type TimedWord } from './captions';

/** Evenly spoken words, 0.4 s each with 0.1 s gaps, starting at `from`. */
function speak(text: string, from = 0): TimedWord[] {
  return text.split(' ').map((word, i) => ({ text: word, start: from + i * 0.5, end: from + i * 0.5 + 0.4 }));
}

describe('buildCues', () => {
  it('never exceeds two lines of 42 characters', () => {
    const cues = buildCues(speak('The citric acid cycle is a series of chemical reactions used by all aerobic organisms to release stored energy through the oxidation of acetyl CoA derived from carbohydrates fats and proteins'));
    expect(cues.length).toBeGreaterThan(1);
    for (const cue of cues) {
      expect(cue.text.length).toBeLessThanOrEqual(MAX_LINE_CHARS * 2);
      expect(wrapCue(cue.text).split('\n').every(line => line.length <= MAX_LINE_CHARS)).toBe(true);
    }
  });

  it('starts a new cue after a pause or at a sentence end', () => {
    const cues = buildCues([...speak('This is the first sentence here.'), ...speak('After a long pause', 10)]);
    expect(cues.map(c => c.text)).toEqual(['This is the first sentence here.', 'After a long pause']);
  });

  it('keeps each cue under about seven seconds', () => {
    const slow: TimedWord[] = Array.from({ length: 12 }, (_, i) => ({ text: 'um', start: i * 0.9, end: i * 0.9 + 0.8 }));
    for (const cue of buildCues(slow)) expect(cue.end - cue.start).toBeLessThanOrEqual(7.01);
  });

  it('holds very short cues for a second without overlapping the next', () => {
    const cues = buildCues([{ text: 'Yes.', start: 0, end: 0.2 }, { text: 'Right.', start: 1.5, end: 1.7 }]);
    expect(cues[0].end).toBe(1);
    const tight = buildCues([{ text: 'Mitochondria-derived-ATP.', start: 0, end: 0.2 }, { text: 'Next', start: 0.5, end: 0.9 }]);
    expect(tight).toHaveLength(2);
    expect(tight[0].end).toBe(0.5);
  });

  it('returns nothing for silence', () => {
    expect(buildCues([])).toEqual([]);
  });
});

describe('WebVTT', () => {
  it('formats timestamps past an hour', () => {
    expect(formatTimestamp(3723.4567)).toBe('01:02:03.457');
  });

  it('writes a valid file and neutralises edits that would break it', () => {
    const vtt = toWebVtt([
      { start: 0, end: 2, text: 'A --> B & <b>' },
      { start: 2, end: 3, text: '   ' },
      { start: 3, end: 4, text: 'Second\n\ncue' },
    ]);
    expect(vtt).toBe('WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nA -> B &amp; &lt;b>\n\n2\n00:00:03.000 --> 00:00:04.000\nSecond cue\n');
  });
});

describe('toTranscript', () => {
  it('breaks paragraphs at long pauses', () => {
    expect(toTranscript([
      { start: 0, end: 2, text: 'First idea.' },
      { start: 2.2, end: 4, text: 'Same idea.' },
      { start: 10, end: 12, text: 'New idea.' },
    ])).toBe('First idea. Same idea.\n\nNew idea.\n');
  });
});
