import type { Chunk } from '../chunk';
import type { EmbeddingVector, TitanEmbedder } from '../embed';
import type { Excerpt } from '../../../shared/references';
import type { VectorStore } from '../vectors';

export interface PageText {
  page: number;
  text: string;
}

export interface ExtractInput {
  path: string;
}

export interface ExtractOutput {
  pages: PageText[];
  pageCount: number;
}

export interface ChunkInput {
  pages: readonly PageText[];
  /** Production indexing supplies this to keep vector keys unique per document. */
  docId?: string;
}

export interface ChunkOutput {
  chunks: Chunk[];
}

export interface EmbedInput {
  profileId: string;
  docId: string;
  kind: string;
  title: string;
  chunks: readonly Chunk[];
}

export interface EmbedOutput {
  vectorCount: number;
  chunkIds: string[];
}

export interface VerifyInput {
  profileId: string;
  pageOneText: string;
  docId?: string;
}

export interface VerifyOutput {
  verified: true;
  query: string;
  excerpts: Excerpt[];
}

export interface ExtractDeps {
  extractPages(path: string): Promise<PageText[]>;
}

export interface EmbedDeps {
  embed: Pick<TitanEmbedder, 'embed'> | { embed(texts: readonly string[]): Promise<EmbeddingVector[]> };
  vectors: Pick<VectorStore, 'put'>;
  chunks?: {
    put(records: readonly ChunkStorageRecord[]): Promise<void>;
  };
}

export interface ChunkStorageRecord {
  profileId: string;
  chunkId: string;
  docId: string;
  page: number;
  charStart: number;
  charEnd: number;
  text: string;
  title: string;
}

export interface VerifyDeps {
  retrieve(profileId: string, query: string, k: number, filter?: { docId?: string }): Promise<Excerpt[]>;
}
