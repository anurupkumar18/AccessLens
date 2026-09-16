import { S3Client } from '@aws-sdk/client-s3';
import type { Excerpt } from '../../shared/references';
import { AwsVectorAdmin, S3ChunkStore } from './aws';
import { TitanEmbedder } from './embed';
import { retrieve, type RetrieveDeps } from './retrieve';

/**
 * Retrieval for the authoring pipeline (spec section 9.4). Stages never
 * query S3 Vectors themselves: the workflow calls this Lambda with the
 * course profile and the text of what it is about to describe, and hands
 * the excerpts to Sonnet. A deck query (`slides`) reads the whole deck in
 * three windows and merges the hits; a slide query (`query`) is one call.
 */
export interface RetrieveEvent {
  profileId: string;
  /** One query: the slide's extracted text. */
  query?: string;
  /** The deck: every slide's extracted text, queried in three windows. */
  slides?: ReadonlyArray<{ extractedText?: string }>;
  k?: number;
}

export interface RetrieveResult {
  excerpts: Excerpt[];
}

export const DECK_WINDOWS = 3;
export const DECK_K = 8;
export const SLIDE_K = 4;

/** Splits the deck's text into up to three contiguous windows, dropping empties. */
export function deckWindows(slides: ReadonlyArray<{ extractedText?: string }>, windows = DECK_WINDOWS): string[] {
  const texts = slides.map(slide => (slide.extractedText ?? '').trim()).filter(text => text.length > 0);
  if (texts.length === 0) return [];
  const size = Math.ceil(texts.length / windows);
  const result: string[] = [];
  for (let start = 0; start < texts.length; start += size) result.push(texts.slice(start, start + size).join('\n\n'));
  return result;
}

export async function retrieveForEvent(event: RetrieveEvent, deps: RetrieveDeps): Promise<RetrieveResult> {
  if (event.slides) {
    const k = event.k ?? DECK_K;
    const byChunk = new Map<string, Excerpt>();
    for (const window of deckWindows(event.slides)) {
      for (const excerpt of await retrieve(event.profileId, window, k, undefined, deps)) {
        const known = byChunk.get(excerpt.chunkId);
        if (!known || known.score < excerpt.score) byChunk.set(excerpt.chunkId, excerpt);
      }
    }
    return { excerpts: [...byChunk.values()].sort((a, b) => b.score - a.score).slice(0, k) };
  }
  return { excerpts: await retrieve(event.profileId, event.query ?? '', event.k ?? SLIDE_K, undefined, deps) };
}

export async function handler(event: RetrieveEvent): Promise<RetrieveResult> {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const libraryBucket = process.env.LIBRARY_BUCKET ?? '';
  const vectorBucket = process.env.VECTOR_BUCKET ?? '';
  if (!libraryBucket || !vectorBucket) throw new Error('LIBRARY_BUCKET and VECTOR_BUCKET are required for retrieval');
  const vectors = new AwsVectorAdmin({ libraryBucket, vectorBucket, profilesTable: '', documentsTable: '' }, region);
  return retrieveForEvent(event, {
    embed: TitanEmbedder.fromBedrock({ region }),
    vectors: { forProfile: id => vectors.store(id) },
    chunks: new S3ChunkStore(new S3Client({ region }), libraryBucket),
  });
}
