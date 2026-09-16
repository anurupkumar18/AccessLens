/**
 * Labelling for content this extension generates rather than quotes.
 *
 * AccessLens's core promise, charter A9, is that unknown content produces an
 * unmatched state and never an invented description. The orb generates
 * explanations of arbitrary pages, which is exactly inventing. That is a
 * deliberate amendment, recorded in `docs/ORB_CHARTER_AMENDMENT.md`: the
 * promise becomes "never invents *silently*".
 *
 * Everything in this module exists to keep the second half of that sentence
 * true. No generated string reaches a student without passing through here.
 */

export const GENERATED_NOTICE =
  'AI-generated. Not reviewed by your instructor. May be wrong.';

export const REVIEWED_NOTICE = 'From your instructor’s reviewed material.';

export type Provenance = 'generated' | 'reviewed';

export interface Attributed<T> {
  readonly provenance: Provenance;
  readonly value: T;
  /** Spoken and displayed before the content itself. Never empty. */
  readonly notice: string;
}

export function generated<T>(value: T): Attributed<T> {
  return { provenance: 'generated', value, notice: GENERATED_NOTICE };
}

export function reviewed<T>(value: T): Attributed<T> {
  return { provenance: 'reviewed', value, notice: REVIEWED_NOTICE };
}

/**
 * The spoken form. The notice comes first, deliberately: a screen-reader or
 * audio-only user must learn the content is unverified *before* they hear it,
 * not after, when they have already taken it as fact.
 */
export function speakableText(item: Attributed<string>): string {
  return `${item.notice} ${item.value}`;
}
