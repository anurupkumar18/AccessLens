/**
 * Timed words -> caption cues -> WebVTT and a plain transcript.
 *
 * The cue rules follow the DCMP captioning key and the BBC subtitle guidelines,
 * because those are what a deaf student's reading speed was measured against:
 * at most two lines of 42 characters, at most about seven seconds on screen,
 * and a break at a sentence end or a pause rather than mid-phrase when there is
 * a choice.
 */

export interface TimedWord {
  text: string;
  /** Seconds from the start of the file. */
  start: number;
  end: number;
}

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export const MAX_LINE_CHARS = 42;
const MAX_CUE_CHARS = MAX_LINE_CHARS * 2;
const MAX_CUE_SECONDS = 7;
/** A silence this long is a new thought even without punctuation. */
const PAUSE_SECONDS = 1;
/** A cue shorter than this flashes past before it can be read. */
const MIN_CUE_SECONDS = 1;

const endsSentence = (word: string) => /[.?!]["')\]]?$/.test(word);

export function buildCues(words: readonly TimedWord[]): Cue[] {
  const cues: Cue[] = [];
  let current: TimedWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    cues.push({ start: current[0].start, end: current[current.length - 1].end, text: current.map(w => w.text).join(' ') });
    current = [];
  };

  for (const word of words) {
    const previous = current[current.length - 1];
    if (previous) {
      const length = current.reduce((sum, w) => sum + w.text.length + 1, 0) + word.text.length;
      const tooLong = length > MAX_CUE_CHARS;
      const tooSlow = word.end - current[0].start > MAX_CUE_SECONDS;
      const paused = word.start - previous.end >= PAUSE_SECONDS;
      const sentenceDone = endsSentence(previous.text) && length > MAX_LINE_CHARS / 2;
      if (tooLong || tooSlow || paused || sentenceDone) flush();
    }
    current.push(word);
  }
  flush();

  // Hold short cues on screen a little longer, but never over the next one.
  return cues.map((cue, i) => {
    const next = cues[i + 1];
    const wanted = Math.max(cue.end, cue.start + MIN_CUE_SECONDS);
    return { ...cue, end: next ? Math.min(wanted, next.start) : wanted };
  });
}

/** Split into at most two lines, as evenly as the word boundaries allow. */
export function wrapCue(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= MAX_LINE_CHARS) return flat;
  const words = flat.split(' ');
  let best = flat;
  let bestScore = Infinity;
  for (let i = 1; i < words.length; i++) {
    const first = words.slice(0, i).join(' ');
    const second = words.slice(i).join(' ');
    const over = Math.max(0, first.length - MAX_LINE_CHARS) + Math.max(0, second.length - MAX_LINE_CHARS);
    const score = over * 1000 + Math.abs(first.length - second.length);
    if (score < bestScore) {
      bestScore = score;
      best = `${first}\n${second}`;
    }
  }
  return best;
}

export function formatTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor(totalMs / 60_000) % 60;
  const s = Math.floor(totalMs / 1000) % 60;
  const ms = totalMs % 1000;
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

/**
 * WebVTT forbids `-->` inside a cue, and a blank line ends the cue early, so
 * instructor edits are normalised rather than trusted to be well formed.
 */
function safeCueText(text: string): string {
  return wrapCue(text.replace(/-->/g, '->').replace(/&/g, '&amp;').replace(/</g, '&lt;'));
}

export function toWebVtt(cues: readonly Cue[]): string {
  const blocks = cues
    .filter(cue => cue.text.trim())
    .map((cue, i) => `${i + 1}\n${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}\n${safeCueText(cue.text)}`);
  return `WEBVTT\n\n${blocks.join('\n\n')}\n`;
}

/** Paragraphs break where the speaker paused, which is where a reader expects them. */
export function toTranscript(cues: readonly Cue[]): string {
  const paragraphs: string[][] = [];
  let lastEnd = -Infinity;
  for (const cue of cues) {
    const text = cue.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (cue.start - lastEnd > 2.5 || paragraphs.length === 0) paragraphs.push([]);
    paragraphs[paragraphs.length - 1].push(text);
    lastEnd = cue.end;
  }
  return paragraphs.map(p => p.join(' ')).join('\n\n') + '\n';
}
