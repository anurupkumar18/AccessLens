/**
 * Transcription results -> `caption.appended` events.
 *
 * Kept free of every AWS import on purpose. The rules here decide what a deaf
 * or hard-of-hearing student actually reads, and they are exactly the rules that
 * are expensive to get wrong and impossible to check by deploying: an empty
 * result must vanish rather than render a blank line, an overlong one must be
 * cut rather than be rejected whole by the relay. Those are testable in
 * milliseconds only if no credential is involved.
 *
 * The event shape is Part 1's frozen contract (`apps/extension/src/shared/
 * contracts.ts`, the `caption.appended` member of `LiveEventSchema`). That
 * member is `.strict()` and carries no `assetId`: a caption is what was *said*,
 * never a claim about what is on screen, so there is no field here in which to
 * assert a match. `text` is `min(1).max(2000)`, which is where both rules below
 * come from.
 */

/** Contract bound on `caption.text`. Not a style choice -- the relay rejects 2001. */
export const MAX_CAPTION_CHARS = 2000;

/**
 * The shape this module needs from a Transcribe `Result`, declared locally so
 * the pure path never imports the SDK. Structurally a subset of the real type,
 * so the adapter in `transcribe.ts` can hand results straight over.
 */
export interface TranscriptAlternativeLike {
  Transcript?: string | undefined;
}

export interface TranscriptResultLike {
  IsPartial?: boolean | undefined;
  Alternatives?: readonly TranscriptAlternativeLike[] | undefined;
  LanguageCode?: string | undefined;
}

export interface Caption {
  text: string;
  isFinal: boolean;
  lang?: string;
}

export interface CaptionAppendedEvent {
  schemaVersion: '1.0';
  type: 'caption.appended';
  sessionId: string;
  packId: string;
  packVersion: number;
  sequence: number;
  sentAt: string;
  caption: Caption;
}

/**
 * `lang` is `min(2).max(16)` and optional in the contract. An out-of-range code
 * is dropped rather than coerced: a caption with no language label still renders,
 * whereas an invalid one fails the whole event at the relay and the student sees
 * nothing at all.
 */
function normalizeLang(value: string | undefined): string | undefined {
  const lang = value?.trim() ?? '';
  return lang.length >= 2 && lang.length <= 16 ? lang : undefined;
}

/**
 * The caption text for a result, or `undefined` if there is nothing to say.
 *
 * Transcribe emits results with an empty transcript during silence and at
 * stream boundaries. Those must produce no event at all -- `text: ''` is not
 * merely useless, it violates `min(1)` and would take the event down with it.
 *
 * Over-long results are cut rather than dropped. A 2000-character caption is
 * already pathological (Transcribe segments far shorter than that), but losing
 * the first 2000 characters of a sentence a student is waiting on is worse than
 * losing its tail.
 */
function captionText(result: TranscriptResultLike): string | undefined {
  const trimmed = (result.Alternatives?.[0]?.Transcript ?? '').trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length <= MAX_CAPTION_CHARS) return trimmed;
  return trimmed.slice(0, MAX_CAPTION_CHARS).trimEnd();
}

/**
 * Map transcription results onto contract-valid `caption.appended` events.
 *
 * Pure apart from one clock read for `sentAt`: the batch came out of a single
 * invocation over a single buffered chunk, so one timestamp for all of them is
 * more honest than pretending to sub-millisecond ordering the audio never had.
 *
 * `sequence` advances only for events that are actually emitted. Silent results
 * must not burn sequence numbers -- students join mid-stream and a consumer that
 * sees 4, 5, 7 has to assume it dropped 6 and wait for a replay that is never
 * coming.
 */
export function toCaptionEvents(
  results: readonly TranscriptResultLike[] | undefined,
  sessionId: string,
  packId: string,
  packVersion: number,
  startSequence: number,
): CaptionAppendedEvent[] {
  const events: CaptionAppendedEvent[] = [];
  const sentAt = new Date().toISOString();

  for (const result of results ?? []) {
    const text = captionText(result);
    if (text === undefined) continue;

    const lang = normalizeLang(result.LanguageCode);
    // `IsPartial === true` is an interim recognition a renderer replaces in
    // place; anything else -- including a result that never set the flag -- has
    // settled and is safe to keep on screen.
    const caption: Caption = { text, isFinal: result.IsPartial !== true };
    if (lang !== undefined) caption.lang = lang;

    events.push({
      schemaVersion: '1.0',
      type: 'caption.appended',
      sessionId,
      packId,
      packVersion,
      sequence: startSequence + events.length,
      sentAt,
      caption,
    });
  }

  return events;
}
