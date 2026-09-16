/**
 * The single library retrieval function (spec §9.3).
 *
 * The search route and every future pipeline stage call this function; stages do
 * not query S3 Vectors themselves. It embeds with Titan v2, queries the one
 * profile index, applies the similarity floor, and resolves verbatim chunk text
 * from the library store.
 */

import type { Excerpt } from '../../shared/references';
import type { EmbeddingVector, TitanEmbedder } from './embed';
import type { QueriedVector } from './vectors';

export const COSINE_SIMILARITY_FLOOR = 0.35;

export interface ChunkExcerptRecord {
  chunkId: string;
  docId: string;
  title: string;
  page: number;
  text: string;
}

export interface ChunkStore {
  /** profileId/docId let an S3-backed store address its private object prefix. */
  get(chunkId: string, profileId?: string, docId?: string): Promise<ChunkExcerptRecord | undefined>;
  listForDocument?(docId: string, profileId?: string): Promise<string[]>;
}

export interface ProfileVectorQuery {
  query(vector: readonly number[], k: number, filter?: { kind?: string; docId?: string }): Promise<QueriedVector[]>;
}

export interface RetrieveDeps {
  embed: Pick<TitanEmbedder, 'embed'> | { embed(texts: readonly string[]): Promise<EmbeddingVector[]> };
  vectors: ProfileVectorQuery | { forProfile(profileId: string): ProfileVectorQuery };
  chunks: ChunkStore;
}

/** One retrieval path for HTTP search and all authoring pipeline stages. */
export async function retrieve(
  profileId: string,
  query: string,
  k: number,
  filter: { kind?: string; docId?: string } | undefined,
  deps: RetrieveDeps,
): Promise<Excerpt[]> {
  if (!query.trim()) return [];
  const [embedding] = await deps.embed.embed([query]);
  if (!embedding) return [];
  const vectorQuery = 'forProfile' in deps.vectors ? deps.vectors.forProfile(profileId) : deps.vectors;
  const hits = await vectorQuery.query(embedding, k, filter);
  const excerpts: Excerpt[] = [];

  for (const hit of hits) {
    if (!hit.key || hit.distance === undefined) continue;
    const score = 1 - hit.distance;
    if (score < COSINE_SIMILARITY_FLOOR) continue;
    const metadataDocId = typeof hit.metadata?.docId === 'string' ? hit.metadata.docId : undefined;
    const record = await deps.chunks.get(hit.key, profileId, metadataDocId);
    if (!record) continue;
    excerpts.push({
      chunkId: record.chunkId,
      docId: record.docId,
      title: record.title,
      page: record.page,
      score,
      text: record.text,
    });
  }
  return excerpts.sort((a, b) => b.score - a.score).slice(0, k);
}
