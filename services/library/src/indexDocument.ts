import type { DocumentRecord } from '../../shared/api';
import { chunkStage } from './stages/chunkStage';
import { embedStage } from './stages/embedStage';
import { extractStage } from './stages/extractStage';
import type { ChunkStorageRecord, PageText } from './stages/types';
import { verifyStage } from './stages/verifyStage';

export interface IndexDocumentInput {
  profileId: string;
  docId: string;
  path: string;
  kind: DocumentRecord['kind'];
  title: string;
  citation?: string;
}

export interface IndexDocumentDeps {
  update(record: Partial<DocumentRecord> & { docId: string }): Promise<void>;
  extractPages(path: string): Promise<PageText[]>;
  embed: Parameters<typeof embedStage>[1]['embed'];
  vectors: Parameters<typeof embedStage>[1]['vectors'];
  chunks: { put(records: readonly ChunkStorageRecord[]): Promise<void>; get(chunkId: string): Promise<{ chunkId: string; docId: string; title: string; page: number; text: string } | undefined> };
  retrieve(profileId: string, query: string, k: number, filter?: { docId?: string }): Promise<import('../../shared/references').Excerpt[]>;
  /** Best-effort post-index extraction. It may create drafts, never published facts. */
  onExtracted?(pages: readonly PageText[]): Promise<void>;
}

/** Runs the four deterministic/indexing stages and leaves a failed record usable. */
export async function indexDocument(input: IndexDocumentInput, deps: IndexDocumentDeps): Promise<DocumentRecord> {
  let stage = 'extract';
  try {
    await deps.update({ docId: input.docId, status: 'extracting', stage });
    const extracted = await extractStage({ path: input.path }, { extractPages: deps.extractPages });
    stage = 'chunk';
    await deps.update({ docId: input.docId, pages: extracted.pageCount, status: 'chunking', stage });

    const chunked = await chunkStage({ pages: extracted.pages, docId: input.docId });
    stage = 'embed';
    await deps.update({ docId: input.docId, chunks: chunked.chunks.length, status: 'embedding', stage });
    await embedStage({ ...input, chunks: chunked.chunks }, { embed: deps.embed, vectors: deps.vectors, chunks: deps.chunks });

    stage = 'verify';
    await deps.update({ docId: input.docId, status: 'verifying', stage });
    await verifyStage({ profileId: input.profileId, docId: input.docId, pageOneText: extracted.pages[0]?.text ?? '' }, { retrieve: deps.retrieve });
    const indexedAt = new Date().toISOString();
    await deps.update({ docId: input.docId, status: 'ready', stage: undefined, indexedAt });
    // A failed optional draft write must never mark an otherwise verified
    // document failed or make retries unsafe.
    await deps.onExtracted?.(extracted.pages).catch(() => undefined);
    return { docId: input.docId, profileId: input.profileId, kind: input.kind, title: input.title, ...(input.citation ? { citation: input.citation } : {}), pages: extracted.pageCount, chunks: chunked.chunks.length, status: 'ready', indexedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.update({ docId: input.docId, status: 'failed', stage, error: message });
    throw new Error(`document ${input.docId} failed at ${stage}: ${message}`);
  }
}
