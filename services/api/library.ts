import { randomUUID } from 'node:crypto';
import { CopyObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { awsClients, DynamoProfileStore, S3ChunkStore } from '../library/src/aws';
import { TitanEmbedder } from '../library/src/embed';
import { retrieve } from '../library/src/retrieve';
import { RouteError, type LibraryRouteDeps, type UploadRecord } from '../library/src/routes/types';
import { validateLibraryPdf } from '../library/src/intake';
import { ApiHttpError } from './http';
import { decksBucket, region, s3 } from './config';
import type { Caller } from './identity';

/**
 * The AWS wiring for the course-library routes (spec section 9). Route logic
 * lives in services/library/src/routes; this module supplies its stores,
 * resolves a presigned upload into the private library prefix, and starts
 * the indexing Lambda. Every route is scoped to the calling instructor.
 */
export interface LibraryConfig {
  libraryBucket: string;
  vectorBucket: string;
  profilesTable: string;
  documentsTable: string;
  indexerFunctionName: string;
}

export function libraryConfig(): LibraryConfig {
  const config = {
    libraryBucket: process.env.LIBRARY_BUCKET ?? '',
    vectorBucket: process.env.VECTOR_BUCKET ?? '',
    profilesTable: process.env.PROFILES_TABLE ?? '',
    documentsTable: process.env.DOCUMENTS_TABLE ?? '',
    indexerFunctionName: process.env.INDEXER_FUNCTION_NAME ?? '',
  };
  if (!config.libraryBucket || !config.vectorBucket || !config.profilesTable || !config.documentsTable) {
    throw new ApiHttpError(500, 'configuration_error', 'The course library storage is not configured.');
  }
  return config;
}

export type LibraryDeps = LibraryRouteDeps & { profiles: DynamoProfileStore };

/** Route dependencies over real AWS; built per invocation so tests never touch it. */
export function libraryDeps(config: LibraryConfig = libraryConfig()): LibraryDeps {
  const clients = awsClients(config);
  const chunks = new S3ChunkStore(s3, config.libraryBucket);
  const embedder = TitanEmbedder.fromBedrock({ region });
  const lambda = new LambdaClient({ region });
  const retrieveForProfile: LibraryRouteDeps['retrieve'] = (profileId, query, k, filter) =>
    retrieve(profileId, query, k, filter, { embed: embedder, vectors: { forProfile: id => clients.vectors.store(id) }, chunks });

  return {
    now: () => new Date(),
    id: () => randomUUID(),
    profiles: clients.profiles as DynamoProfileStore,
    documents: clients.documents,
    uploads: decksUploads(),
    s3: clients.s3,
    vectors: clients.vectors,
    listChunkKeys: async docId => {
      const record = await clients.documents.get(docId);
      return record ? chunks.listForDocument(docId, record.profileId) : [];
    },
    retrieve: retrieveForProfile,
    validateUpload: validateLibraryPdf,
    async startIndexing(input) {
      // The presigned upload landed in the decks bucket; the library keeps
      // its own private copy under the profile prefix (spec 9.1) and the
      // decks copy expires with the bucket's seven-day rule.
      const extension = input.path.toLowerCase().match(/\.(pdf)$/u)?.[1] ?? 'pdf';
      const sourceKey = `library/${input.profileId}/${input.docId}/source.${extension}`;
      await s3.send(new CopyObjectCommand({ Bucket: config.libraryBucket, Key: sourceKey, CopySource: `${decksBucket}/${input.path}` }));
      if (!config.indexerFunctionName) throw new ApiHttpError(500, 'configuration_error', 'The library indexer is not configured.');
      await lambda.send(new InvokeCommand({
        FunctionName: config.indexerFunctionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({
          profileId: input.profileId,
          docId: input.docId,
          kind: input.kind,
          title: input.title,
          ...(input.citation ? { citation: input.citation } : {}),
          timeZone: input.timeZone,
          sourceKey,
        })),
      }));
    },
  };
}

/** Presigned uploads are staged under `quarantine/{uploadId}/` until PDF intake accepts them. */
function decksUploads(): LibraryRouteDeps['uploads'] {
  const seen = new Map<string, UploadRecord>();
  return {
    async get(uploadId: string) {
      const cached = seen.get(uploadId);
      if (cached) return cached;
      const listed = await s3.send(new ListObjectsV2Command({ Bucket: decksBucket, Prefix: `quarantine/${uploadId}/` })) as { Contents?: Array<{ Key?: string }> };
      const key = (listed.Contents ?? []).flatMap(object => object.Key ? [object.Key] : [])[0];
      if (!key) return undefined;
      const head = await s3.send(new HeadObjectCommand({ Bucket: decksBucket, Key: key }));
      const body = await s3.send(new GetObjectCommand({ Bucket: decksBucket, Key: key, Range: 'bytes=0-7' }));
      const record: UploadRecord = { key, contentType: head.ContentType, contentLength: head.ContentLength, firstBytes: body.Body ? await body.Body.transformToByteArray() : undefined };
      seen.set(uploadId, record);
      return record;
    },
    delete() { /* uploads expire with the decks bucket lifecycle rule */ },
  };
}

/** Route-logic errors become the API's error shape. */
export async function libraryCall<T>(caller: Caller, call: (deps: LibraryDeps, ownerSub: string) => Promise<T>): Promise<T> {
  try {
    return await call(libraryDeps(), caller.sub);
  } catch (error) {
    if (error instanceof RouteError) {
      const status = error.code === 'not-found' ? 404 : error.code === 'conflict' ? 409 : 400;
      throw new ApiHttpError(status, error.code.replace('-', '_'), error.message);
    }
    throw error;
  }
}
