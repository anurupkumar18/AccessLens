import { beforeEach, describe, expect, it } from 'vitest';
import type { Deck } from '../shared/jobs';
import type { JobRecord } from '../shared/jobs';
import { AccessPackSchema } from '../../apps/extension/src/shared/contracts';
import { PublishValidationError, publishPack, type ObjectStore, type StagedAsset } from './index';

const deck: Deck = {
  jobId: 'job-1', packId: 'pack-1', title: 'Graph lesson', sourceKey: 'uploads/deck.pdf', sourceFormat: 'pdf',
  matching: { algorithm: 'dhash12', hashBits: 132, maxHammingDistance: 26, minMargin: 14, onNoMatch: 'source.unmatched' },
  slides: [
    { assetId: 'slide-01', page: 1, mediaKey: 'staging/job-1/media/slide-01.png', width: 1920, height: 1080, fingerprint: 'dhash12:fingerprint-1', extractedText: 'Graph' },
    { assetId: 'slide-02', page: 2, mediaKey: 'staging/job-1/media/slide-02.png', width: 1920, height: 1080, fingerprint: 'dhash12:fingerprint-2', extractedText: 'Search' },
  ],
};

const job = (over: Partial<JobRecord> = {}): JobRecord => ({
  jobId: 'job-1', packId: 'pack-1', title: 'Graph lesson', uploadId: 'upload-1', status: 'review',
  createdAt: '2026-09-15T00:00:00.000Z', updatedAt: '2026-09-15T00:00:00.000Z', expiresAt: 1_800_000_000,
  slides: [
    { assetId: 'slide-01', stage: 'done', status: 'ok' },
    { assetId: 'slide-02', stage: 'done', status: 'ok' },
  ], visualHints: [], reviewedAssetIds: ['slide-01', 'slide-02'], decisions: [], ...over,
});

const stagedAsset = (assetId: string, over: Partial<StagedAsset> = {}): StagedAsset => ({
  assetId,
  mediaUri: `staging/job-1/media/${assetId}.png`,
  title: assetId,
  readingOrder: ['title', 'graph', 'rejected'],
  regions: [
    { regionId: 'graph', bounds: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, shortDescription: 'A graph.', plainLanguage: 'Connected dots.', audioUri: `staging/job-1/media/${assetId}.graph.mp3` },
    { regionId: 'rejected', bounds: { x: 0.6, y: 0.1, width: 0.2, height: 0.2 }, shortDescription: 'A rejected region.', plainLanguage: 'A region.' },
  ],
  ...over,
});

class FakeStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  readonly writes: Array<{ key: string; body: Uint8Array | string }> = [];
  readonly copies: Array<{ source: string; destination: string }> = [];

  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter(key => key.startsWith(prefix));
  }
  async read(key: string): Promise<Uint8Array> {
    const body = this.objects.get(key);
    if (!body) throw new Error(`missing ${key}`);
    return body;
  }
  async write(key: string, body: Uint8Array | string): Promise<void> {
    this.writes.push({ key, body });
    this.objects.set(key, typeof body === 'string' ? new TextEncoder().encode(body) : body);
  }
  async copy(source: string, destination: string): Promise<void> {
    this.copies.push({ source, destination });
    const body = this.objects.get(source);
    if (!body) throw new Error(`missing ${source}`);
    this.objects.set(destination, body);
  }
}

function validArtifactManifest(): Record<string, unknown> {
  return {
    schemaVersion: '1.0', artifactId: 'graph-stepper', artifactVersion: 1,
    title: 'Graph stepper', summary: 'A graph.', subjects: ['computer-science'], tags: ['graph'],
    interaction: 'stepper', provenance: { kind: 'generated', generatedBy: 'test', jobId: 'job-1' },
    parameters: { type: 'object', properties: {} }, defaultParameters: {}, libraries: [],
    accessibility: { description: 'A graph.', keyboard: 'Use arrows.' },
    render: { entry: 'index.html', minWidth: 480, minHeight: 320 },
  };
}

function storeWithStagedMedia(): FakeStore {
  const store = new FakeStore();
  for (const key of [
    'staging/job-1/media/slide-01.png', 'staging/job-1/media/slide-01.graph.mp3',
    'staging/job-1/media/slide-02.png', 'staging/job-1/media/slide-02.graph.mp3',
  ]) store.objects.set(key, new Uint8Array([1, 2, 3]));
  store.objects.set('packs/pack-1/1.json', new Uint8Array([123]));
  return store;
}

describe('publishPack', () => {
  it('refuses an unreviewed asset before any published write', async () => {
    const store = storeWithStagedMedia();
    const unreviewed = job({ reviewedAssetIds: ['slide-01'] });
    await expect(publishPack({ job: unreviewed, deck, assets: [stagedAsset('slide-01'), stagedAsset('slide-02')] }, store))
      .rejects.toThrow(/not reviewed/i);
    expect(store.writes).toEqual([]);
    expect(store.copies).toEqual([]);
  });

  it('fails before any destination write when no public base URL is configured', async () => {
    const store = storeWithStagedMedia();
    await expect(publishPack({
      job: job(), deck, assets: [stagedAsset('slide-01'), stagedAsset('slide-02', { readingOrder: ['title', 'graph'], regions: [stagedAsset('slide-02').regions[0]] })],
    }, store)).rejects.toThrow(/publicBaseUrl/i);
    expect(store.writes).toEqual([]);
    expect(store.copies).toEqual([]);
  });

  it('uses the staged asset mediaUri as its source and rejects an unsafe source before writing', async () => {
    const store = storeWithStagedMedia();
    store.objects.set('staging/job-1/media/custom-slide-01.png', new Uint8Array([4, 5, 6]));
    await expect(publishPack({
      job: job(),
      deck,
      assets: [stagedAsset('slide-01', { mediaUri: 'staging/job-1/media/custom-slide-01.png' }), stagedAsset('slide-02', { readingOrder: ['title', 'graph'], regions: [stagedAsset('slide-02').regions[0]] })],
      publicBaseUrl: 'https://cdn.example.test',
    }, store)).resolves.toMatchObject({ version: 2 });
    expect(store.copies).toContainEqual({ source: 'staging/job-1/media/custom-slide-01.png', destination: 'media/pack-1/2/slide-01.png' });

    const unsafe = storeWithStagedMedia();
    await expect(publishPack({
      job: job(), deck,
      assets: [stagedAsset('slide-01', { mediaUri: 'staging/job-1/../../outside.png' }), stagedAsset('slide-02', { readingOrder: ['title', 'graph'], regions: [stagedAsset('slide-02').regions[0]] })],
      publicBaseUrl: 'https://cdn.example.test',
    }, unsafe)).rejects.toThrow(/staging/i);
    expect(unsafe.writes).toEqual([]);
    expect(unsafe.copies).toEqual([]);
  });

  it('applies edits, removes rejected regions from readingOrder, computes version two, and rewrites media paths', async () => {
    const store = storeWithStagedMedia();
    const result = await publishPack({
      job: job({ decisions: [{
        assetId: 'slide-01',
        regionEdits: [{ regionId: 'graph', shortDescription: 'Edited graph.', plainLanguage: 'Edited dots.' }],
        rejectRegions: ['rejected'],
      }] }),
      deck,
      assets: [stagedAsset('slide-01'), stagedAsset('slide-02', { readingOrder: ['title', 'graph'], regions: [stagedAsset('slide-02').regions[0]] })],
      publicBaseUrl: 'https://cdn.example.test',
      synthesizeAudio: async () => new Uint8Array([7]),
    }, store);

    expect(result.version).toBe(2);
    expect(result.packUrl).toBe('https://cdn.example.test/packs/pack-1/2.json');
    const pack = result.pack;
    expect(AccessPackSchema.parse(pack)).toEqual(pack);
    expect(pack.assets[0].regions).toHaveLength(1);
    expect(pack.assets[0].regions[0].shortDescription).toBe('Edited graph.');
    expect(pack.assets[0].readingOrder).not.toContain('rejected');
    expect(pack.assets[0].mediaUri).toBe('media/pack-1/2/slide-01.png');
    expect(pack.assets[0].regions[0].audioUri).toBe('media/pack-1/2/slide-01.graph.mp3');
    expect(pack.assets[0].fingerprint).toBe(deck.slides[0].fingerprint);
    // The edited region's clip is spoken fresh and written; the stale staged clip is not copied.
    expect(store.writes.map(write => write.key)).toEqual(['media/pack-1/2/slide-01.graph.mp3', 'packs/pack-1/2.json']);
    expect(store.writes.map(write => write.key)).not.toContain('packs/pack-1/1.json');
    expect(store.copies).toEqual(expect.arrayContaining([
      { source: 'staging/job-1/media/slide-01.png', destination: 'media/pack-1/2/slide-01.png' },
      { source: 'staging/job-1/media/slide-02.graph.mp3', destination: 'media/pack-1/2/slide-02.graph.mp3' },
    ]));
    expect(store.copies.map(copy => copy.source)).not.toContain('staging/job-1/media/slide-01.graph.mp3');
  });

  it('re-speaks a region whose short description was edited, and never copies its stale clip', async () => {
    const store = new FakeStore();
    store.objects.set('staging/job-1/media/slide-01.png', new Uint8Array([1]));
    store.objects.set('staging/job-1/media/slide-02.png', new Uint8Array([1]));
    store.objects.set('staging/job-1/media/slide-01.graph.mp3', new Uint8Array([2]));
    store.objects.set('staging/job-1/media/slide-02.graph.mp3', new Uint8Array([2]));
    const spoken: string[] = [];
    const result = await publishPack({
      job: job({ decisions: [{ assetId: 'slide-01', regionEdits: [{ regionId: 'graph', shortDescription: 'A directed graph.' }] }] }),
      deck,
      assets: [stagedAsset('slide-01'), stagedAsset('slide-02')],
      publicBaseUrl: 'https://cdn.test',
      synthesizeAudio: async text => { spoken.push(text); return new Uint8Array([9, 9]); },
    }, store);
    expect(spoken).toEqual(['A directed graph.']);
    const edited = result.pack.assets[0].regions.find(r => r.regionId === 'graph')!;
    expect(edited.shortDescription).toBe('A directed graph.');
    expect(edited.audioUri).toBe('media/pack-1/1/slide-01.graph.mp3');
    expect(store.objects.get('media/pack-1/1/slide-01.graph.mp3')).toEqual(new Uint8Array([9, 9]));
    expect(store.copies.map(c => c.source)).not.toContain('staging/job-1/media/slide-01.graph.mp3');
    // The untouched slide's clip is copied as before.
    expect(store.copies.map(c => c.source)).toContain('staging/job-1/media/slide-02.graph.mp3');
  });

  it('drops the clip of an edited region when no synthesizer is available, rather than shipping stale speech', async () => {
    const store = new FakeStore();
    store.objects.set('staging/job-1/media/slide-01.png', new Uint8Array([1]));
    store.objects.set('staging/job-1/media/slide-02.png', new Uint8Array([1]));
    store.objects.set('staging/job-1/media/slide-01.graph.mp3', new Uint8Array([2]));
    store.objects.set('staging/job-1/media/slide-02.graph.mp3', new Uint8Array([2]));
    const result = await publishPack({
      job: job({ decisions: [{ assetId: 'slide-01', regionEdits: [{ regionId: 'graph', shortDescription: 'A directed graph.', plainLanguage: 'Arrows between dots.' }] }] }),
      deck,
      assets: [stagedAsset('slide-01'), stagedAsset('slide-02')],
      publicBaseUrl: 'https://cdn.test',
    }, store);
    const edited = result.pack.assets[0].regions.find(r => r.regionId === 'graph')!;
    expect(edited.audioUri).toBeUndefined();
    expect(edited.plainLanguage).toBe('Arrows between dots.');
    expect(store.copies.map(c => c.source)).not.toContain('staging/job-1/media/slide-01.graph.mp3');
  });

  it('keeps the staged clip when an edit only touches the plain-language text', async () => {
    const store = new FakeStore();
    store.objects.set('staging/job-1/media/slide-01.png', new Uint8Array([1]));
    store.objects.set('staging/job-1/media/slide-02.png', new Uint8Array([1]));
    store.objects.set('staging/job-1/media/slide-01.graph.mp3', new Uint8Array([2]));
    store.objects.set('staging/job-1/media/slide-02.graph.mp3', new Uint8Array([2]));
    const result = await publishPack({
      job: job({ decisions: [{ assetId: 'slide-01', regionEdits: [{ regionId: 'graph', plainLanguage: 'Dots joined by lines.' }] }] }),
      deck, assets: [stagedAsset('slide-01'), stagedAsset('slide-02')], publicBaseUrl: 'https://cdn.test',
      synthesizeAudio: async () => { throw new Error('must not be called'); },
    }, store);
    expect(result.pack.assets[0].regions.find(r => r.regionId === 'graph')!.audioUri).toBe('media/pack-1/1/slide-01.graph.mp3');
    expect(store.copies.map(c => c.source)).toContain('staging/job-1/media/slide-01.graph.mp3');
  });

  it('copies a staged approved artifact without touching an earlier pack version', async () => {
    const store = storeWithStagedMedia();
    store.objects.set('staging/job-1/artifacts/graph-stepper/1/manifest.json', new TextEncoder().encode(JSON.stringify(validArtifactManifest())));
    store.objects.set('staging/job-1/artifacts/graph-stepper/1/index.html', new TextEncoder().encode('<!doctype html>'));
    const result = await publishPack({
      job: job({ decisions: [{ assetId: 'slide-01', visualization: 'approve' }] }),
      deck,
      assets: [stagedAsset('slide-01', { visualization: { artifactId: 'graph-stepper', artifactVersion: 1, parameters: {} } }), stagedAsset('slide-02', { readingOrder: ['title', 'graph'], regions: [stagedAsset('slide-02').regions[0]] })],
      publicBaseUrl: 'https://cdn.example.test',
    }, store);
    expect(result.pack.assets[0].visualization?.artifactId).toBe('graph-stepper');
    expect(store.copies).toContainEqual({ source: 'staging/job-1/artifacts/graph-stepper/1/index.html', destination: 'artifacts/graph-stepper/1/index.html' });
  });

  it('rejects an approved artifact whose manifest is invalid before any published write', async () => {
    const store = storeWithStagedMedia();
    store.objects.set('staging/job-1/artifacts/graph-stepper/1/manifest.json', new TextEncoder().encode('{"not":"a manifest"}'));
    store.objects.set('staging/job-1/artifacts/graph-stepper/1/index.html', new TextEncoder().encode('<!doctype html>'));
    await expect(publishPack({
      job: job({ decisions: [{ assetId: 'slide-01', visualization: 'approve' }] }),
      deck,
      assets: [stagedAsset('slide-01', { visualization: { artifactId: 'graph-stepper', artifactVersion: 1, parameters: {} } }), stagedAsset('slide-02', { readingOrder: ['title', 'graph'], regions: [stagedAsset('slide-02').regions[0]] })],
      publicBaseUrl: 'https://cdn.example.test',
    }, store)).rejects.toThrow(/manifest/i);
    expect(store.writes).toEqual([]);
    expect(store.copies).toEqual([]);
  });

  it('validates the finished pack before writing the pack key', async () => {
    const store = storeWithStagedMedia();
    const invalid = stagedAsset('slide-01', { regions: [{ regionId: 'bad', bounds: { x: 2, y: 0, width: 1, height: 1 }, shortDescription: 'Bad.', plainLanguage: 'Bad.' }] });
    await expect(publishPack({ job: job({ reviewedAssetIds: ['slide-01'] }), deck, assets: [invalid] }, store))
      .rejects.toBeInstanceOf(PublishValidationError);
    expect(store.writes).toEqual([]);
    expect(store.copies).toEqual([]);
  });
});
