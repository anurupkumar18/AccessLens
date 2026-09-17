import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { CreateIndexCommand, DataType, DeleteIndexCommand, DistanceMetric, S3VectorsClient } from '@aws-sdk/client-s3vectors';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { DocumentRecord, ProfileRecord } from '../../shared/api';
import type { ChunkExcerptRecord } from './retrieve';
import { awsVectorStore, type S3VectorStore, type VectorClient, type VectorLocation } from './vectors';
import type { LibraryObjectStore, LibraryVectorAdmin, RecordStore } from './routes/types';
import type { ChunkStorageRecord } from './stages/types';

export interface AwsLibraryConfig {
  region?: string;
  libraryBucket: string;
  vectorBucket: string;
  profilesTable: string;
  documentsTable: string;
}

export function awsClients(config: AwsLibraryConfig): {
  s3: LibraryObjectStore;
  profiles: RecordStore<ProfileRecord>;
  documents: RecordStore<DocumentRecord>;
  vectors: AwsVectorAdmin;
} {
  const region = config.region ?? process.env.AWS_REGION ?? 'us-east-1';
  const s3 = new S3Client({ region });
  const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  return {
    s3: new S3LibraryStore(s3, config.libraryBucket),
    profiles: new DynamoProfileStore(dynamo, config.profilesTable),
    documents: new DynamoDocumentStore(dynamo, config.documentsTable),
    vectors: new AwsVectorAdmin(config, region),
  };
}

export class S3LibraryStore implements LibraryObjectStore {
  constructor(private readonly client: Pick<S3Client, 'send'>, private readonly bucket: string) {}

  async put(key: string, body: string | Uint8Array, contentType = 'application/octet-stream'): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: [{ Key: key }] } }));
  }

  async deletePrefix(prefix: string): Promise<void> {
    let token: string | undefined;
    do {
      const response = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      const objects = (response.Contents ?? []).flatMap(object => object.Key ? [{ Key: object.Key }] : []);
      if (objects.length > 0) await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: objects } }));
      token = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (token);
  }

  async download(key: string, destinationPath: string): Promise<void> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!response.Body) throw new Error(`S3 object ${key} had no body`);
    // Lambda's indexing adapter normally streams directly to /tmp. This small
    // helper keeps the route surface dependency-injected and avoids exposing a
    // whole document through an HTTP response.
    const fs = await import('node:fs');
    const body = await response.Body.transformToByteArray();
    await fs.promises.writeFile(destinationPath, body);
  }
}

abstract class DynamoRecordStore<T> implements RecordStore<T> {
  constructor(protected readonly client: Pick<DynamoDBDocumentClient, 'send'>, protected readonly table: string) {}
  abstract key(value: T | string): Record<string, string>;
  abstract indexCondition(profileId: string): Record<string, unknown>;

  async get(key: string): Promise<T | undefined> {
    const response = await this.client.send(new GetCommand({ TableName: this.table, Key: this.key(key) }));
    return response.Item as T | undefined;
  }
  async put(value: T): Promise<void> {
    await this.client.send(new PutCommand({ TableName: this.table, Item: value as Record<string, unknown> }));
  }
  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteCommand({ TableName: this.table, Key: this.key(key) }));
  }
  async list(profileId?: string): Promise<T[]> {
    if (!profileId) {
      const response = await this.client.send(new ScanCommand({ TableName: this.table }));
      return (response.Items ?? []) as T[];
    }
    const response = await this.client.send(new QueryCommand({
      TableName: this.table,
      ...this.indexCondition(profileId),
    }));
    return (response.Items ?? []) as T[];
  }
}

export class DynamoProfileStore extends DynamoRecordStore<ProfileRecord> {
  key(value: ProfileRecord | string): Record<string, string> {
    return { profileId: typeof value === 'string' ? value : value.profileId };
  }
  indexCondition(_profileId: string): Record<string, unknown> { return {}; }
  async listByOwner(ownerSub: string): Promise<ProfileRecord[]> {
    const response = await this.client.send(new QueryCommand({
      TableName: this.table,
      IndexName: 'ownerSub-index',
      KeyConditionExpression: 'ownerSub = :ownerSub',
      ExpressionAttributeValues: { ':ownerSub': ownerSub },
    }));
    return ((response.Items ?? []) as ProfileRecord[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export class DynamoDocumentStore extends DynamoRecordStore<DocumentRecord> {
  key(value: DocumentRecord | string): Record<string, string> {
    return { docId: typeof value === 'string' ? value : value.docId };
  }
  indexCondition(profileId: string): Record<string, unknown> {
    return { IndexName: 'profileId-index', KeyConditionExpression: 'profileId = :profileId', ExpressionAttributeValues: { ':profileId': profileId } };
  }
}

export class AwsVectorAdmin implements LibraryVectorAdmin {
  private readonly stores = new Map<string, S3VectorStore>();
  private readonly client: VectorClient;
  private readonly vectorBucket: string;
  private readonly region: string;

  constructor(config: AwsLibraryConfig, region: string) {
    this.region = region;
    this.vectorBucket = config.vectorBucket;
    this.client = new S3VectorsClient({ region }) as unknown as VectorClient;
  }

  async createIndex(profileId: string): Promise<void> {
    try {
      await this.client.send(new CreateIndexCommand({
        vectorBucketName: this.vectorBucket,
        indexName: profileId,
        dataType: DataType.FLOAT32,
        dimension: 1024,
        distanceMetric: DistanceMetric.COSINE,
        metadataConfiguration: { nonFilterableMetadataKeys: ['title'] },
      }));
    } catch (error) {
      const name = error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : '';
      if (name !== 'ConflictException' && name !== 'ResourceAlreadyExistsException') throw error;
    }
    this.stores.set(profileId, awsVectorStore({ bucketName: this.vectorBucket, indexName: profileId }, { region: this.region }));
  }

  async deleteIndex(profileId: string): Promise<void> {
    try {
      await this.client.send(new DeleteIndexCommand({ vectorBucketName: this.vectorBucket, indexName: profileId }));
    } catch (error) {
      const name = error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : '';
      if (name !== 'NotFoundException' && name !== 'ResourceNotFoundException') throw error;
    }
    this.stores.delete(profileId);
  }

  async delete(keys: readonly string[], profileId?: string): Promise<void> {
    if (profileId && keys.length > 0) await this.store(profileId).delete(keys);
  }

  store(profileId: string): S3VectorStore {
    const existing = this.stores.get(profileId);
    if (existing) return existing;
    const store = awsVectorStore({ bucketName: this.vectorBucket, indexName: profileId }, { region: this.region });
    this.stores.set(profileId, store);
    return store;
  }
}

export class S3ChunkStore {
  constructor(private readonly client: Pick<S3Client, 'send'>, private readonly bucket: string) {}

  async put(records: readonly ChunkStorageRecord[]): Promise<void> {
    await Promise.all(records.map(record => this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: `library/${record.profileId}/${record.docId}/chunks/${record.chunkId}.json`,
      Body: JSON.stringify(record),
      ContentType: 'application/json',
    }))));
  }

  async get(chunkId: string, profileId?: string, docId?: string): Promise<ChunkExcerptRecord | undefined> {
    try {
      const key = profileId && docId
        ? `library/${profileId}/${docId}/chunks/${chunkId}.json`
        : `chunks/${chunkId}.json`;
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!response.Body) return undefined;
      return JSON.parse(await response.Body.transformToString()) as ChunkExcerptRecord;
    } catch (error) {
      if (error && typeof error === 'object' && 'name' in error && String((error as { name: unknown }).name) === 'NoSuchKey') return undefined;
      throw error;
    }
  }

  async listForDocument(docId: string, profileId?: string): Promise<string[]> {
    const prefix = profileId ? `library/${profileId}/${docId}/chunks/` : `chunks/${docId}:`;
    const response = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix }));
    return (response.Contents ?? []).flatMap(object => object.Key?.replace(/^.*\/chunks\//u, '').replace(/\.json$/u, '') ?? []);
  }
}
