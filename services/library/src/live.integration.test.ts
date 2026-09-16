import { afterAll, describe, expect, it } from 'vitest';
import { CreateIndexCommand, CreateVectorBucketCommand, DeleteIndexCommand, DeleteVectorBucketCommand, DataType, DistanceMetric, S3VectorsClient } from '@aws-sdk/client-s3vectors';
import { TitanEmbedder } from './embed';
import { S3VectorStore } from './vectors';

const live = process.env.ACCESSLENS_RUN_AWS_INTEGRATION === '1';
const account = process.env.AWS_ACCOUNT_ID ?? '087328706621';
const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const bucketName = `accesslens-library-test-${suffix}`.slice(0, 63);
const indexName = `profile-test-${suffix}`.slice(0, 63);

const client = new S3VectorsClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

describe.skipIf(!live)('live Titan and S3 Vectors proof', () => {
  let indexReady = false;

  afterAll(async () => {
    if (!indexReady) return;
    try { await client.send(new DeleteIndexCommand({ vectorBucketName: bucketName, indexName })); } catch { /* cleanup best effort */ }
    try { await client.send(new DeleteVectorBucketCommand({ vectorBucketName: bucketName })); } catch { /* cleanup best effort */ }
  });

  it('embeds a page-12 query, writes, and retrieves the matching page chunk', async () => {
    expect(account).toMatch(/^\d{12}$/u);
    await client.send(new CreateVectorBucketCommand({ vectorBucketName: bucketName }));
    await client.send(new CreateIndexCommand({
      vectorBucketName: bucketName,
      indexName,
      dataType: DataType.FLOAT32,
      dimension: 1024,
      distanceMetric: DistanceMetric.COSINE,
      metadataConfiguration: { nonFilterableMetadataKeys: ['title'] },
    }));
    indexReady = true;

    const embedder = TitanEmbedder.fromBedrock({ region: 'us-east-1' });
    const [pageOne, pageTwelve] = await embedder.embed([
      'Page 1 establishes the proof sentence for this document.',
      'Page 12 defines the distinctive eigenvector pivot concept for retrieval.',
    ]);
    const store = new S3VectorStore(client, { bucketName, indexName });
    await store.put([
      { key: 'doc:p1-c0', vector: pageOne, metadata: { docId: 'doc', page: 1, kind: 'notes', title: 'Distinctive Notes' } },
      { key: 'doc:p12-c0', vector: pageTwelve, metadata: { docId: 'doc', page: 12, kind: 'notes', title: 'Distinctive Notes' } },
    ]);
    const hits = await store.query(pageTwelve, 3, { docId: 'doc' });
    expect(hits[0]).toMatchObject({ key: 'doc:p12-c0' });
  }, 60_000);
});
