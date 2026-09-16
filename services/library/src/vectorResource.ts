import {
  CreateIndexCommand,
  CreateVectorBucketCommand,
  DataType,
  DeleteIndexCommand,
  DeleteVectorBucketCommand,
  DistanceMetric,
  S3VectorsClient,
} from '@aws-sdk/client-s3vectors';
import type { VectorClient, VectorResourceRequest, VectorResourceResponse } from './vectors';

/**
 * CloudFormation has no native S3 Vectors resource. The infra lane should add
 * one AWS CustomResource whose service token is this Lambda and whose
 * properties are `BucketName`, `IndexName`, and optional `Dimension` (1024).
 * Delete removes the per-profile index before the vector bucket, so destroy
 * leaves no S3 Vectors resources behind.
 */
export async function vectorResourceHandler(
  event: VectorResourceRequest,
  context?: { logStreamName?: string },
): Promise<VectorResourceResponse> {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const client = new S3VectorsClient({ region });
  const properties = event.ResourceProperties;
  const indexName = properties.IndexName ?? 'profile-default';
  const physicalResourceId = `${properties.BucketName}/${indexName}`;

  if (event.RequestType === 'Delete') {
    await deleteResources(client, properties.BucketName, indexName);
    return { PhysicalResourceId: event.PhysicalResourceId ?? physicalResourceId };
  }

  if (event.RequestType === 'Update') {
    // A profile's name and index are immutable at runtime. Returning the same
    // physical id makes CloudFormation treat a property-only update as an
    // idempotent no-op while preserving the existing index.
    return { PhysicalResourceId: event.PhysicalResourceId ?? physicalResourceId };
  }

  const created = await createResources(client, properties.BucketName, indexName, properties.Dimension ?? 1024);
  return {
    PhysicalResourceId: physicalResourceId,
    Data: { BucketName: properties.BucketName, IndexName: indexName, IndexArn: created.indexArn },
  };
}

async function createResources(client: VectorClient, bucketName: string, indexName: string, dimension: number): Promise<{ indexArn?: string }> {
  const bucket = await client.send(new CreateVectorBucketCommand({ vectorBucketName: bucketName })) as { vectorBucketArn?: string };
  const index = await client.send(new CreateIndexCommand({
    vectorBucketName: bucketName,
    indexName,
    dataType: DataType.FLOAT32,
    dimension,
    distanceMetric: DistanceMetric.COSINE,
    metadataConfiguration: { nonFilterableMetadataKeys: ['title'] },
  })) as { indexArn?: string };
  return { indexArn: index.indexArn ?? bucket.vectorBucketArn };
}

async function deleteResources(client: VectorClient, bucketName: string, indexName: string): Promise<void> {
  try {
    await client.send(new DeleteIndexCommand({ vectorBucketName: bucketName, indexName }));
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  try {
    await client.send(new DeleteVectorBucketCommand({ vectorBucketName: bucketName }));
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

function isNotFound(error: unknown): boolean {
  const name = error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : '';
  return name === 'NotFoundException' || name === 'ResourceNotFoundException';
}

export type { VectorResourceRequest, VectorResourceResponse };
