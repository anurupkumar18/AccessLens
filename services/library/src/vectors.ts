import {
  CreateIndexCommand,
  CreateVectorBucketCommand,
  DataType,
  DeleteIndexCommand,
  DeleteVectorBucketCommand,
  DeleteVectorsCommand,
  DistanceMetric,
  PutVectorsCommand,
  QueryVectorsCommand,
  S3VectorsClient,
  type PutInputVector,
  type QueryOutputVector,
} from '@aws-sdk/client-s3vectors';

export interface VectorMetadata {
  docId: string;
  page: number;
  kind: string;
  title: string;
}

export interface StoredVector {
  key: string;
  vector: number[];
  metadata: VectorMetadata;
}

export interface QueriedVector {
  key?: string;
  distance?: number;
  metadata?: Record<string, unknown>;
}

export interface VectorClient {
  send(command: { input: unknown }): Promise<unknown>;
}

export interface VectorLocation {
  bucketName: string;
  indexName: string;
  indexArn?: string;
}

export interface VectorStore {
  put(vectors: readonly StoredVector[]): Promise<void>;
  query(vector: readonly number[], k: number, filter?: { kind?: string; docId?: string }): Promise<QueriedVector[]>;
  delete(keys: readonly string[]): Promise<void>;
}

/**
 * S3 Vectors is intentionally the only vector backend here. Its SDK is now
 * available, so this adapter uses PutVectors and QueryVectors directly rather
 * than hiding a substitute vector database behind a compatibility layer.
 */
export class S3VectorStore implements VectorStore {
  constructor(private readonly client: VectorClient, private readonly location: VectorLocation) {}

  async put(vectors: readonly StoredVector[]): Promise<void> {
    if (vectors.length === 0) return;
    const inputVectors: PutInputVector[] = vectors.map(vector => ({
      key: vector.key,
      data: { float32: [...vector.vector] },
      metadata: {
        docId: vector.metadata.docId,
        page: vector.metadata.page,
        kind: vector.metadata.kind,
        title: vector.metadata.title,
      },
    }));
    await this.client.send(new PutVectorsCommand({
      vectorBucketName: this.location.bucketName,
      indexName: this.location.indexName,
      ...(this.location.indexArn ? { indexArn: this.location.indexArn } : {}),
      vectors: inputVectors,
    }));
  }

  async query(vector: readonly number[], k: number, filter?: { kind?: string; docId?: string }): Promise<QueriedVector[]> {
    const response = await this.client.send(new QueryVectorsCommand({
      vectorBucketName: this.location.bucketName,
      indexName: this.location.indexName,
      ...(this.location.indexArn ? { indexArn: this.location.indexArn } : {}),
      topK: k,
      queryVector: { float32: [...vector] },
      filter: buildMetadataFilter(filter ?? {}) as unknown as import('@smithy/types').DocumentType | undefined,
      returnMetadata: true,
      returnDistance: true,
    }));
    const vectors = (response as { vectors?: QueryOutputVector[] }).vectors ?? [];
    return vectors.map(item => ({
      key: item.key,
      distance: item.distance,
      metadata: item.metadata as unknown as Record<string, unknown> | undefined,
    }));
  }

  async delete(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.client.send(new DeleteVectorsCommand({
      vectorBucketName: this.location.bucketName,
      indexName: this.location.indexName,
      ...(this.location.indexArn ? { indexArn: this.location.indexArn } : {}),
      keys: [...keys],
    }));
  }
}

/**
 * S3 Vectors' filter document is an equality expression. `$and` is used only
 * when both optional constraints are present, keeping the no-filter query a
 * genuine unfiltered QueryVectors call.
 */
export function buildMetadataFilter(filter: { kind?: string; docId?: string }): Record<string, unknown> | undefined {
  const clauses = [
    filter.kind ? { kind: { $eq: filter.kind } } : undefined,
    filter.docId ? { docId: { $eq: filter.docId } } : undefined,
  ].filter((clause): clause is NonNullable<typeof clause> => clause !== undefined);
  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

export interface VectorResourceRequest {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResourceProperties: {
    BucketName: string;
    IndexName?: string;
    Dimension?: number;
  };
  PhysicalResourceId?: string;
}

export interface VectorResourceResponse {
  PhysicalResourceId: string;
  Data?: { BucketName: string; IndexName: string; IndexArn?: string };
}

/** Creates/deletes the S3 Vectors resources CloudFormation cannot model natively. */
export async function createVectorResources(
  client: VectorClient,
  properties: VectorResourceRequest['ResourceProperties'],
): Promise<VectorResourceResponse> {
  const bucket = await client.send(new CreateVectorBucketCommand({ vectorBucketName: properties.BucketName })) as { vectorBucketArn?: string };
  const index = await client.send(new CreateIndexCommand({
    vectorBucketName: properties.BucketName,
    indexName: properties.IndexName ?? 'profile-default',
    dataType: DataType.FLOAT32,
    dimension: properties.Dimension ?? 1024,
    distanceMetric: DistanceMetric.COSINE,
    // `title` is returned with hits but is not used as a filter; docId, page,
    // and kind remain filterable for the API's optional constraints.
    metadataConfiguration: { nonFilterableMetadataKeys: ['title'] },
  })) as { indexArn?: string };
  const indexName = properties.IndexName ?? 'profile-default';
  return {
    PhysicalResourceId: `${properties.BucketName}/${indexName}`,
    Data: { BucketName: properties.BucketName, IndexName: indexName, ...(index.indexArn ? { IndexArn: index.indexArn } : {}) },
  };
}

export async function deleteVectorResources(
  client: VectorClient,
  properties: VectorResourceRequest['ResourceProperties'],
): Promise<void> {
  const indexName = properties.IndexName ?? 'profile-default';
  try {
    await client.send(new DeleteIndexCommand({ vectorBucketName: properties.BucketName, indexName }));
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  try {
    await client.send(new DeleteVectorBucketCommand({ vectorBucketName: properties.BucketName }));
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

function isNotFound(error: unknown): boolean {
  const name = error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : '';
  return name === 'NotFoundException' || name === 'ResourceNotFoundException';
}

/** A ready-to-use AWS store for Lambda code. */
export function awsVectorStore(location: VectorLocation, options: { region?: string } = {}): S3VectorStore {
  return new S3VectorStore(new S3VectorsClient({ region: options.region ?? process.env.AWS_REGION ?? 'us-east-1' }), location);
}
