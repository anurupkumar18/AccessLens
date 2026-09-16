import type { Chunk } from '../chunk';
import type { EmbedDeps, EmbedInput, EmbedOutput, ChunkStorageRecord } from './types';

/** Write Titan vectors and the verbatim chunk manifest for one document. */
export async function embedStage(input: EmbedInput, deps: EmbedDeps): Promise<EmbedOutput> {
  if (input.chunks.length === 0) return { vectorCount: 0, chunkIds: [] };
  const vectors = await deps.embed.embed(input.chunks.map(chunk => chunk.text));
  if (vectors.length !== input.chunks.length) {
    throw new Error(`embedding output count ${vectors.length} does not match chunk count ${input.chunks.length}`);
  }

  // A document namespace prevents two documents with identical page text from
  // overwriting each other's S3 Vectors keys while preserving the chunk's
  // page/ordinal identity for debugging and citation traces.
  const records = input.chunks.map(chunk => toStorageRecord(input, chunk));
  await deps.vectors.put(records.map((record, index) => ({
    key: record.chunkId,
    vector: vectors[index],
    metadata: { docId: input.docId, page: record.page, kind: input.kind, title: input.title },
  })));
  if (deps.chunks) await deps.chunks.put(records);
  return { vectorCount: vectors.length, chunkIds: records.map(record => record.chunkId) };
}

function toStorageRecord(input: EmbedInput, chunk: Chunk): ChunkStorageRecord {
  const base = chunk.chunkId.startsWith(`${input.docId}:`) ? chunk.chunkId : `${input.docId}:${chunk.chunkId}`;
  return { ...chunk, profileId: input.profileId, chunkId: base, docId: input.docId, title: input.title };
}
