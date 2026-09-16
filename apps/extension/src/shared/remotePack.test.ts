import { describe, it, expect, afterEach } from 'vitest';
import { loadRemotePack, remotePackUrl } from './remotePack';
import { slideImageUrl, resetRemotePackBasesForTests } from './packMedia';
import publishedPack from '../../../viewer/fixtures/published-pack.json';

const PACK_URL = new URL('https://d7dxgg82mglf.cloudfront.net/packs/hnsw-explainer/2.json');

function fetchReturning(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
}

afterEach(() => resetRemotePackBasesForTests());

describe('remotePackUrl', () => {
  it('reads an https pack url from the query string', () => {
    expect(remotePackUrl(`?pack=${encodeURIComponent(PACK_URL.toString())}`)?.toString()).toBe(PACK_URL.toString());
  });
  it('is null with no pack parameter', () => {
    expect(remotePackUrl('')).toBeNull();
    expect(remotePackUrl('?role=student')).toBeNull();
  });
  it('refuses anything that is not https', () => {
    for (const bad of ['http://example.test/p.json', 'file:///tmp/p.json', 'chrome-extension://abc/p.json', 'not a url']) {
      expect(remotePackUrl(`?pack=${encodeURIComponent(bad)}`), bad).toBeNull();
    }
  });
});

describe('loadRemotePack', () => {
  it('loads a published pack and resolves its media against the distribution root', async () => {
    const pack = await loadRemotePack(PACK_URL, fetchReturning(200, publishedPack));
    expect(pack.packId).toBe('hnsw-explainer');
    const asset = pack.assets.find(a => a.mediaUri)!;
    // mediaUri is `media/<packId>/<version>/slide-NN.png`, relative to the
    // distribution root, not to the pack file's own directory.
    expect(slideImageUrl(pack, asset)).toBe(`https://d7dxgg82mglf.cloudfront.net/${asset.mediaUri}`);
  });

  it('refuses a pack that fails the schema rather than rendering it', async () => {
    await expect(loadRemotePack(PACK_URL, fetchReturning(200, { packId: 'x' }))).rejects.toThrow();
  });

  it('refuses a non-2xx response', async () => {
    await expect(loadRemotePack(PACK_URL, fetchReturning(404, {}))).rejects.toThrow(/HTTP 404/);
  });

  it('leaves bundled packs resolving from the bundle when nothing remote is registered', () => {
    expect(slideImageUrl({ packId: 'no-such-pack' }, { mediaUri: 'media/x/1/slide-01.png' })).toBeNull();
  });
});
