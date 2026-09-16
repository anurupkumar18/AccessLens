import { describe, expect, it } from 'vitest';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { JobRecord } from '../shared/jobs';
import type { Deck } from '../shared/jobs';
import { getJobDraft, publishJob, reviewJob, type PublishRouteDeps } from './routes';
import type { ObjectStore } from './index';

const job: JobRecord = {
  jobId: 'job-1', packId: 'pack-1', title: 'Graph lesson', uploadId: 'upload-1', status: 'review',
  createdAt: '2026-09-15T00:00:00.000Z', updatedAt: '2026-09-15T00:00:00.000Z', expiresAt: 1_800_000_000,
  slides: [{ assetId: 'slide-01', stage: 'done', status: 'ok' }], visualHints: [], reviewedAssetIds: [], decisions: [],
};

const deck: Deck = {
  jobId: 'job-1', packId: 'pack-1', title: 'Graph lesson', sourceKey: 'uploads/deck.pdf', sourceFormat: 'pdf',
  matching: { algorithm: 'dhash12', hashBits: 132, maxHammingDistance: 26, minMargin: 14, onNoMatch: 'source.unmatched' },
  slides: [{ assetId: 'slide-01', page: 1, mediaKey: 'staging/job-1/media/slide-01.png', width: 1920, height: 1080, fingerprint: 'dhash12:one', extractedText: 'Graph' }],
};

class FakeStore implements ObjectStore {
  objects = new Map<string, Uint8Array>();
  async list(prefix: string): Promise<string[]> { return [...this.objects.keys()].filter(key => key.startsWith(prefix)); }
  async read(key: string): Promise<Uint8Array> { const value = this.objects.get(key); if (!value) throw new Error(`missing ${key}`); return value; }
  async write(key: string, body: Uint8Array | string): Promise<void> { this.objects.set(key, typeof body === 'string' ? new TextEncoder().encode(body) : body); }
  async copy(source: string, destination: string): Promise<void> { this.objects.set(destination, await this.read(source)); }
}

class FakeDynamo {
  item: JobRecord = structuredClone(job);
  updates: unknown[] = [];
  async send(command: unknown): Promise<unknown> {
    if (command instanceof GetCommand) return { Item: this.item };
    if (command instanceof UpdateCommand) {
      this.updates.push(command);
      const values = command.input.ExpressionAttributeValues as Record<string, unknown>;
      this.item = {
        ...this.item,
        status: values[':status'] as JobRecord['status'] ?? this.item.status,
        decisions: values[':decisions'] as JobRecord['decisions'] ?? this.item.decisions,
        reviewedAssetIds: values[':reviewedAssetIds'] as string[] ?? this.item.reviewedAssetIds,
        updatedAt: values[':updatedAt'] as string ?? this.item.updatedAt,
      };
      return { Attributes: this.item };
    }
    throw new Error('unexpected DynamoDB command');
  }
}

function deps(dynamo = new FakeDynamo(), store = new FakeStore()): PublishRouteDeps & { dynamo: FakeDynamo; store: FakeStore } {
  store.objects.set('staging/job-1/deck.json', new TextEncoder().encode(JSON.stringify(deck)));
  store.objects.set('staging/job-1/draft/slide-01.json', new TextEncoder().encode(JSON.stringify({
    assetId: 'slide-01', mediaUri: 'staging/job-1/media/slide-01.png', title: 'Graph', readingOrder: ['title', 'graph'],
    fingerprint: 'ignored', regions: [{ regionId: 'graph', bounds: { x: 0, y: 0, width: 1, height: 1 }, shortDescription: 'A graph.', plainLanguage: 'Connected dots.' }],
  })));
  return {
    dynamodb: dynamo,
    s3: store,
    jobsTableName: 'jobs',
    packsBucket: 'packs',
    publicBaseUrl: 'https://cdn.example.test',
    dynamo,
    store,
  };
}

describe('authoring routes', () => {
  it('returns a validated draft assembled from staged deck and slide assets', async () => {
    const result = await getJobDraft({ jobId: 'job-1' }, deps());
    expect(result.jobId).toBe('job-1');
    expect(result.status).toBe('review');
    expect(result.pack.assets[0]).toMatchObject({ assetId: 'slide-01', fingerprint: 'dhash12:one', mediaUri: 'staging/job-1/media/slide-01.png' });
    expect(result.visualizations).toEqual([]);
  });

  it('records every review decision and adds each decided asset to reviewedAssetIds', async () => {
    const dependency = deps();
    const result = await reviewJob({ jobId: 'job-1', decisions: [{ assetId: 'slide-01', rejectRegions: ['graph'] }] }, dependency);
    expect(result).toEqual({ jobId: 'job-1', status: 'review', reviewedAssetIds: ['slide-01'] });
    expect(dependency.dynamo.updates).toHaveLength(1);
    expect(dependency.dynamo.item.decisions).toEqual([{ assetId: 'slide-01', rejectRegions: ['graph'] }]);
  });

  it('marks a job publishing and delegates the actual deterministic publish stage', async () => {
    const dependency = deps();
    let calledWith = '';
    dependency.publish = async input => {
      calledWith = input.jobId;
      return { packId: 'pack-1', version: 2, packUrl: 'https://cdn.example.test/packs/pack-1/2.json' };
    };
    const result = await publishJob({ jobId: 'job-1' }, dependency);
    expect(calledWith).toBe('job-1');
    expect(result).toEqual({ packId: 'pack-1', version: 2, packUrl: 'https://cdn.example.test/packs/pack-1/2.json' });
    expect(dependency.dynamo.item.status).toBe('published');
  });
});
