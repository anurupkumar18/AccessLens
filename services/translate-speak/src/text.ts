/**
 * Text limits and the split that keeps translated output speakable.
 *
 * Two different limits collide here, which is the whole reason this file exists:
 *
 *   - The *request* is capped at 3000 characters. Translate's own limit is
 *     larger, but this endpoint is driven by UI text — a caption, a region
 *     description, a reviewed paragraph — and a caller sending a whole chapter
 *     is a bug on their side, not a job to accept silently.
 *   - `SynthesizeSpeech` accepts at most 3000 characters of input text per call.
 *
 * Those numbers being equal is a trap. Translation is not length-preserving:
 * English to German or Spanish routinely expands 20-35%, so a request that is
 * legal on the way in can be illegal on the way to Polly. Truncating there would
 * silently drop the end of an instructor-reviewed sentence, which is the exact
 * failure this product cannot have. So the translated text is split instead.
 *
 * Splitting is safe for MP3 specifically: an MP3 file is a sequence of
 * self-describing frames, so concatenating the bytes of several single-voice
 * `SynthesizeSpeech` responses produces a file that plays start to finish. This
 * would not hold for a container format like MP4.
 */

/** Maximum characters accepted from the caller, before translation. */
export const MAX_INPUT_CHARS = 3000;

/** Polly's hard per-call limit on input text characters. */
export const POLLY_TEXT_LIMIT = 3000;

/**
 * Sentence-ish segments, terminators kept.
 *
 * Includes CJK full-width stops (`。！？`) because the languages most likely to
 * need this service are also the ones that never use an ASCII period. A split on
 * `[.!?]` alone would treat a Japanese paragraph as one unsplittable segment and
 * fall through to the hard-slice path every time.
 */
const SEGMENT = /[^.!?。！？\n]*(?:[.!?。！？]+|\n+|$)/g;

/**
 * Split text into pieces Polly will accept, preferring sentence boundaries.
 *
 * Boundaries matter for more than tidiness: Polly's prosody is computed per
 * call, so cutting mid-sentence produces an audible falling intonation in the
 * middle of a thought. A sentence boundary cut is nearly inaudible.
 */
export function splitForSpeech(text: string, limit: number = POLLY_TEXT_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const segments = text.match(SEGMENT)?.filter((segment) => segment.length > 0) ?? [text];
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (current.trim().length > 0) chunks.push(current);
    current = '';
  };

  for (const segment of segments) {
    if (segment.length > limit) {
      // One sentence longer than the whole limit — a wall of text with no
      // punctuation, or a language this splitter has no boundary rule for.
      // Nothing clever is available, so slice it and accept the seam.
      flush();
      for (let index = 0; index < segment.length; index += limit) {
        chunks.push(segment.slice(index, index + limit));
      }
      continue;
    }
    if (current.length + segment.length > limit) flush();
    current += segment;
  }
  flush();

  // Only possible if the input was entirely whitespace, which `flush` drops.
  return chunks.length > 0 ? chunks : [text.slice(0, limit)];
}
