import { describe, expect, it } from 'vitest';
import type { AccessPack } from '../../apps/extension/src/shared/contracts';
import { synthesizeSlideAudio, type PollyTransport } from './index';

const asset: AccessPack['assets'][number] = {
  assetId: 'slide-01',
  mediaUri: 'staging/job-1/media/slide-01.png',
  fingerprint: 'dhash12:abc',
  title: 'Slide',
  readingOrder: ['one', 'two'],
  regions: [
    { regionId: 'one', bounds: { x: 0, y: 0, width: 0.5, height: 0.5 }, shortDescription: 'First region.', plainLanguage: 'First.' },
    { regionId: 'two', bounds: { x: 0.5, y: 0, width: 0.5, height: 0.5 }, shortDescription: 'Second region.', plainLanguage: 'Second.' },
  ],
};

class FakePolly implements PollyTransport {
  calls: Array<Record<string, unknown>> = [];
  constructor(private readonly failOn?: number) {}
  async synthesize(input: Record<string, unknown>): Promise<Uint8Array> {
    this.calls.push(input);
    if (this.calls.length === this.failOn) throw new Error('Polly unavailable');
    return new TextEncoder().encode(`mp3-${this.calls.length}`);
  }
}

describe('synthesizeSlideAudio', () => {
  it('makes one Polly call per region and writes under the job staging prefix', async () => {
    const polly = new FakePolly();
    const writes: Array<{ key: string; body: Uint8Array; contentType: string }> = [];
    const result = await synthesizeSlideAudio({
      jobId: 'job-1', packId: 'pack-1', asset,
    }, { polly, putObject: async write => { writes.push(write); } });
    expect(polly.calls).toHaveLength(2);
    expect(polly.calls.map(call => call.Text)).toEqual(['First region.', 'Second region.']);
    expect(writes.map(write => write.key)).toEqual([
      'staging/job-1/media/slide-01.one.mp3',
      'staging/job-1/media/slide-01.two.mp3',
    ]);
    expect(writes.every(write => write.contentType === 'audio/mpeg')).toBe(true);
    expect(result.asset.regions.map(region => region.audioUri)).toEqual([
      'staging/job-1/media/slide-01.one.mp3',
      'staging/job-1/media/slide-01.two.mp3',
    ]);
  });

  it('leaves a failed region without audio and does not fail the slide', async () => {
    const polly = new FakePolly(2);
    const writes: Array<{ key: string }> = [];
    const result = await synthesizeSlideAudio({ jobId: 'job-1', packId: 'pack-1', asset }, {
      polly,
      putObject: async write => { writes.push(write); },
    });
    expect(result.status).toBe('ok');
    expect(result.asset.regions[0].audioUri).toBe('staging/job-1/media/slide-01.one.mp3');
    expect(result.asset.regions[1].audioUri).toBeUndefined();
    expect(writes).toHaveLength(1);
  });
});
