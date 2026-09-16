import type { VerifyDeps, VerifyInput, VerifyOutput } from './types';

/**
 * Acceptance gate from spec §9.2: the actual page-one sentence must retrieve
 * a page-one chunk from this document. A successful call is the only path that
 * may transition a document to `ready`.
 */
export async function verifyStage(input: VerifyInput, deps: VerifyDeps): Promise<VerifyOutput> {
  const query = firstSentence(input.pageOneText);
  if (!query) throw new Error('cannot verify document: page 1 has no sentence');
  const excerpts = await deps.retrieve(input.profileId, query, 3, input.docId ? { docId: input.docId } : undefined);
  const pageOne = excerpts.find(excerpt => excerpt.page === 1 && (!input.docId || excerpt.docId === input.docId));
  if (!pageOne) throw new Error('verification failed: page 1 sentence did not retrieve a page 1 chunk');
  return { verified: true, query, excerpts };
}

function firstSentence(text: string): string {
  const compact = text.replace(/\s+/gu, ' ').trim();
  if (!compact) return '';
  const match = compact.match(/^(.+?[.!?](?:\s|$)|.+$)/u);
  return (match?.[1] ?? compact).trim();
}
