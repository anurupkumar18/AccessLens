import { chunkPages } from '../chunk';
import type { ChunkInput, ChunkOutput } from './types';

export async function chunkStage(input: ChunkInput): Promise<ChunkOutput> {
  const chunks = chunkPages(input.pages);
  if (!input.docId) return { chunks };
  return { chunks: chunks.map(chunk => ({ ...chunk, chunkId: `${input.docId}:${chunk.chunkId}` })) };
}
