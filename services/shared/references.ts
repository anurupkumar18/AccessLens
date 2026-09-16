// Reference verification: a model may cite only what it was actually shown.
//
// Spec §9.4 and the build prompt's "Don't let a model cite what it was not
// shown". A citation is a promise the student can check. A page number the
// model guessed, or a quote it paraphrased, is worse than no citation at all,
// because it carries the authority of a verified one. So every reference any
// agent stage emits passes through here, and a reference survives only when
// its quote is a verbatim substring of an excerpt that call was given.
//
// This is deterministic string matching on purpose. Nothing here asks a model
// whether a model told the truth.
import { z } from 'zod';
import { PACK_REFERENCE_QUOTE_MAX } from '../../apps/extension/src/shared/contracts';

/** One retrieved chunk handed to an agent, spec §9.3. */
export const ExcerptSchema = z.object({
  chunkId: z.string().min(1),
  docId: z.string().min(1),
  title: z.string().min(1),
  page: z.number().int().positive(),
  score: z.number(),
  text: z.string(),
}).strict();
export type Excerpt = z.infer<typeof ExcerptSchema>;

/** What an agent claims. Unverified until it has been through `verifyReferences`. */
export const ClaimedReferenceSchema = z.object({
  docId: z.string().min(1),
  page: z.number().int().positive(),
  quote: z.string().min(1),
}).strict();
export type ClaimedReference = z.infer<typeof ClaimedReferenceSchema>;

/** What survives, and what the pack carries (`AccessPackSchema` asset `references[]`). */
export interface VerifiedReference {
  docId: string;
  title: string;
  page: number;
  quote: string;
}

export interface VerificationResult {
  kept: VerifiedReference[];
  /** One line per dropped claim, for the CloudWatch counter the spec asks for. */
  dropped: { reference: ClaimedReference; reason: DropReason }[];
}

export type DropReason =
  | 'no-excerpt-for-doc-and-page'
  | 'quote-not-verbatim-in-excerpt'
  | 'quote-empty-after-normalisation';

/**
 * Whitespace-normalise for comparison only. PDF text extraction breaks lines
 * mid-sentence and a model that read the excerpt will reflow it; treating that
 * as a paraphrase would drop honest citations and teach nothing. Every other
 * difference -- a changed word, a changed number, a changed symbol -- still
 * fails, which is the property that matters. The quote stored in the pack is
 * the normalised form, so what a student is shown is what was matched.
 */
export function normaliseForMatch(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/**
 * Keep a claimed reference only if some excerpt from the same document and page
 * verbatim contains its quote. Drops everything else and says why.
 *
 * The doc-and-page constraint is not redundant with the substring check: a
 * quote that appears on page 4 but is cited as page 12 sends a student to the
 * wrong page, which is the same broken promise as inventing it.
 */
export function verifyReferences(
  claimed: readonly ClaimedReference[],
  excerpts: readonly Excerpt[],
): VerificationResult {
  const kept: VerifiedReference[] = [];
  const dropped: VerificationResult['dropped'] = [];
  const seen = new Set<string>();

  for (const reference of claimed) {
    const quote = normaliseForMatch(reference.quote);
    if (!quote) {
      dropped.push({ reference, reason: 'quote-empty-after-normalisation' });
      continue;
    }
    const candidates = excerpts.filter(e => e.docId === reference.docId && e.page === reference.page);
    if (candidates.length === 0) {
      dropped.push({ reference, reason: 'no-excerpt-for-doc-and-page' });
      continue;
    }
    const source = candidates.find(e => normaliseForMatch(e.text).includes(quote));
    if (!source) {
      dropped.push({ reference, reason: 'quote-not-verbatim-in-excerpt' });
      continue;
    }
    const capped = quote.slice(0, PACK_REFERENCE_QUOTE_MAX);
    const key = `${source.docId}#${source.page}#${capped}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ docId: source.docId, title: source.title, page: source.page, quote: capped });
  }

  return { kept, dropped };
}

/**
 * Attach to an agent's output schema so every stage that can carry references
 * validates them the same way. Spec §9.4: "Every agent output schema gains an
 * optional `references[]`".
 */
export const ClaimedReferencesField = z.array(ClaimedReferenceSchema).max(8).default([]);
