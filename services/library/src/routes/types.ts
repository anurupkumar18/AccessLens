import type { DocumentRecord, ProfileRecord } from '../../../shared/api';
import type { Excerpt } from '../../../shared/references';

/** A tiny async-capable record surface; Map remains a valid unit-test fake. */
export interface RecordStore<T> {
  get(key: string): T | undefined | Promise<T | undefined>;
  set?(key: string, value: T): void | Promise<void>;
  put?(value: T): void | Promise<void>;
  delete(key: string): boolean | void | Promise<boolean | void>;
  values?(): Iterable<T> | AsyncIterable<T> | Promise<Iterable<T> | AsyncIterable<T>>;
  list?(profileId?: string): Iterable<T> | AsyncIterable<T> | Promise<Iterable<T> | AsyncIterable<T>>;
  /** Profiles by owning instructor (D13). */
  listByOwner?(ownerSub: string): Promise<T[]>;
}

export type RecordCollection<T> = Map<string, T> | RecordStore<T>;

export interface UploadRecord {
  key: string;
  /** Set on first registration so retrying the same upload reuses its docId. */
  docId?: string;
  /** Allows one presigned upload to be registered in more than one profile without key collisions. */
  profileDocIds?: Record<string, string>;
}

export interface LibraryObjectStore {
  put?(key: string, body: string | Uint8Array, contentType?: string): Promise<void>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  copy?(sourceKey: string, destinationKey: string): Promise<void>;
  download?(key: string, destinationPath: string): Promise<void>;
}

export interface LibraryVectorAdmin {
  createIndex(profileId: string): Promise<void>;
  deleteIndex(profileId: string): Promise<void>;
  delete(keys: readonly string[], profileId?: string): Promise<void>;
}

export interface StartIndexingInput {
  profileId: string;
  docId: string;
  path: string;
  kind: DocumentRecord['kind'];
  title: string;
  citation?: string;
}

export interface LibraryRouteDeps {
  now(): Date;
  id(): string;
  profiles: RecordCollection<ProfileRecord>;
  documents: RecordCollection<DocumentRecord>;
  uploads: RecordCollection<UploadRecord>;
  s3: LibraryObjectStore;
  vectors: LibraryVectorAdmin;
  startIndexing(input: StartIndexingInput): Promise<void>;
  /** Reads exact S3 Vectors keys recorded in the chunk manifest. */
  listChunkKeys?(docId: string): Promise<string[]>;
  retrieve(profileId: string, query: string, k: number, filter?: { kind?: DocumentRecord['kind']; docId?: string }): Promise<Excerpt[]>;
}

/** `ownerSub` is the caller's Google subject (D13). A profile owned by anyone else reads as not found. */
export interface CreateProfileInput {
  ownerSub?: string;
  name: string;
  subject: string;
  level: string;
}
export interface ProfilePath { profileId: string; ownerSub?: string }
export interface DocumentPath { profileId: string; docId: string; ownerSub?: string }
export interface RegisterDocumentInput {
  profileId: string;
  ownerSub?: string;
  uploadId: string;
  kind: DocumentRecord['kind'];
  title: string;
  citation?: string;
}
export interface SearchProfileInput {
  profileId: string;
  ownerSub?: string;
  query: string;
  k?: number;
  kind?: DocumentRecord['kind'];
  docId?: string;
}

export class RouteError extends Error {
  constructor(public readonly code: 'not-found' | 'bad-request' | 'conflict', message: string) {
    super(message);
    this.name = 'RouteError';
  }
}

export async function storeGet<T>(store: RecordCollection<T>, key: string): Promise<T | undefined> {
  return store.get(key);
}

export async function storePut<T>(store: RecordCollection<T>, key: string, value: T): Promise<void> {
  if (store instanceof Map) {
    store.set(key, value);
    return;
  }
  if (store.put) {
    await store.put(value);
    return;
  }
  if (store.set) {
    await store.set(key, value);
    return;
  }
  throw new Error('record store is not writable');
}

export async function storeDelete<T>(store: RecordCollection<T>, key: string): Promise<void> {
  await store.delete(key);
}

export async function storeValues<T>(store: RecordCollection<T>, profileId?: string): Promise<T[]> {
  if (store instanceof Map) return [...store.values()];
  const source = store.list ? store.list(profileId) : store.values ? store.values() : [];
  const values = await source;
  const result: T[] = [];
  for await (const value of values as Iterable<T> | AsyncIterable<T>) result.push(value);
  return result;
}
