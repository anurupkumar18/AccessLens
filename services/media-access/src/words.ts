/**
 * Transcribe results -> timed words.
 *
 * Captions for a recorded lecture need timings, which the live captions service
 * deliberately throws away. Cue building happens in the extension, because the
 * extension knows where this chunk sits in the file and the instructor edits the
 * text there; this module only has to hand back words it can trust.
 *
 * Kept free of AWS imports, like `services/captions/src/captions.ts`.
 */

export interface TranscriptItemLike {
  Content?: string | undefined;
  Type?: string | undefined;
  StartTime?: number | undefined;
  EndTime?: number | undefined;
}

export interface TranscriptResultLike {
  IsPartial?: boolean | undefined;
  Alternatives?: readonly { Items?: readonly TranscriptItemLike[] | undefined }[] | undefined;
}

/** Seconds from the start of the chunk. */
export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

/**
 * Final results only: a streaming session re-emits every partial as it firms up,
 * so keeping partials would caption each phrase several times over.
 *
 * Punctuation items carry no timing of their own and are glued onto the word
 * before them, which is where a reader expects the comma.
 */
export function toTimedWords(results: readonly TranscriptResultLike[] | undefined): TimedWord[] {
  const words: TimedWord[] = [];
  for (const result of results ?? []) {
    if (result.IsPartial === true) continue;
    for (const item of result.Alternatives?.[0]?.Items ?? []) {
      const content = item.Content?.trim();
      if (!content) continue;
      if (item.Type === 'punctuation') {
        const previous = words.at(-1);
        if (previous) previous.text += content;
        continue;
      }
      if (typeof item.StartTime !== 'number' || typeof item.EndTime !== 'number') continue;
      words.push({ text: content, start: round(item.StartTime), end: round(Math.max(item.EndTime, item.StartTime)) });
    }
  }
  return words;
}
