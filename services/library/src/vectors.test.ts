import { describe, expect, it, vi } from 'vitest';
import { buildMetadataFilter, S3VectorStore, type VectorClient } from './vectors';

describe('S3VectorStore', () => {
  it('writes only the specified metadata and queries with optional filters', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        distanceMetric: 'cosine',
        vectors: [{ key: 'chunk-1', distance: 0.1, metadata: { docId: 'doc', page: 12, kind: 'notes', title: 'Title' } }],
      });
    const client: VectorClient = { send };
    const store = new S3VectorStore(client, { bucketName: 'bucket', indexName: 'profile-1' });

    await store.put([{ key: 'chunk-1', vector: [1, 0], metadata: { docId: 'doc', page: 12, kind: 'notes', title: 'Title' } }]);
    const result = await store.query([1, 0], 3, { kind: 'notes', docId: 'doc' });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].input).toMatchObject({
      vectorBucketName: 'bucket', indexName: 'profile-1',
      vectors: [{ key: 'chunk-1', data: { float32: [1, 0] }, metadata: { docId: 'doc', page: 12, kind: 'notes', title: 'Title' } }],
    });
    expect(send.mock.calls[1][0].input).toMatchObject({
      vectorBucketName: 'bucket', indexName: 'profile-1', topK: 3,
      queryVector: { float32: [1, 0] }, returnMetadata: true, returnDistance: true,
      filter: buildMetadataFilter({ kind: 'notes', docId: 'doc' }),
    });
    expect(result[0]).toMatchObject({ key: 'chunk-1', distance: 0.1 });
  });

  it('deletes vectors by key before a document is re-indexed', async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = new S3VectorStore({ send }, { bucketName: 'bucket', indexName: 'profile-1' });
    await store.delete(['a', 'b']);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ input: {
      vectorBucketName: 'bucket', indexName: 'profile-1', keys: ['a', 'b'],
    }}));
  });
});

describe('buildMetadataFilter', () => {
  it('returns no filter when no criteria are supplied', () => {
    expect(buildMetadataFilter({})).toBeUndefined();
  });
});
