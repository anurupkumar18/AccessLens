import { describe, expect, it } from 'vitest';
import { listPublishedPacks } from './publishedPacks';

const base = { jobId: 'j', uploadId: 'u', createdAt: '2026-09-16T10:00:00.000Z', expiresAt: 1, slides: [], visualHints: [], reviewedAssetIds: [], decisions: [] };
const jobs = [
  { ...base, jobId: 'j1', packId: 'intro-hnsw', title: 'Introduction to HNSW', status: 'published', publishedVersion: 1, updatedAt: '2026-09-16T18:22:00.000Z' },
  { ...base, jobId: 'j2', packId: 'intro-hnsw', title: 'Introduction to HNSW', status: 'published', publishedVersion: 2, updatedAt: '2026-09-16T18:40:00.000Z' },
  { ...base, jobId: 'j3', packId: 'cells', title: 'Cells', status: 'published', publishedVersion: 1, updatedAt: '2026-09-16T19:00:00.000Z' },
  { ...base, jobId: 'j4', packId: 'unfinished', title: 'Unfinished', status: 'review', updatedAt: '2026-09-16T19:30:00.000Z' },
];

describe('listPublishedPacks', () => {
  it('queries the owner index and keeps the newest published version per pack id, newest first', async () => {
    const inputs: unknown[] = [];
    const dynamodb = { async send(command: { input: unknown }) { inputs.push(command.input); return { Items: jobs }; } };
    const packs = await listPublishedPacks('g-1', { dynamodb, tableName: 'Jobs', assetBaseUrl: 'https://cdn.test' });
    expect(inputs).toEqual([expect.objectContaining({ TableName: 'Jobs', IndexName: 'ownerSub-index', ExpressionAttributeValues: { ':ownerSub': 'g-1' } })]);
    expect(packs).toEqual([
      { packId: 'cells', title: 'Cells', version: 1, packUrl: 'https://cdn.test/packs/cells/1.json', publishedAt: '2026-09-16T19:00:00.000Z' },
      { packId: 'intro-hnsw', title: 'Introduction to HNSW', version: 2, packUrl: 'https://cdn.test/packs/intro-hnsw/2.json', publishedAt: '2026-09-16T18:40:00.000Z' },
    ]);
  });
});
