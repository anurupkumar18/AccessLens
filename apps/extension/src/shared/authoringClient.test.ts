import { describe, it, expect } from 'vitest';
import { createAuthoringClient, deckContentType, packIdFromTitle, AuthoringApiError } from './authoringClient';
import publishedPack from '../../../viewer/fixtures/published-pack.json';

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown };

function fakeApi() {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); const method = init?.method ?? 'GET';
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ url, method, headers, body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/v1/uploads')) return json(201, { uploadId: 'u1', url: 'https://decks.s3.amazonaws.com/uploads/u1/deck.pdf?sig', expiresAt: '2026-09-16T00:00:00Z' });
    if (url.startsWith('https://decks.s3')) return new Response('', { status: 200 });
    if (url.endsWith('/v1/jobs')) return json(201, { jobId: 'j1', status: 'queued' });
    if (url.endsWith('/v1/jobs/j1')) return json(200, { jobId: 'j1', status: 'review', packId: 'hnsw-explainer', slides: [{ assetId: 'slide-01', stage: 'audio', status: 'no_visual' }] });
    if (url.endsWith('/v1/jobs/j1/draft')) return json(200, { jobId: 'j1', status: 'review', pack: publishedPack, visualizations: [] });
    if (url.endsWith('/v1/jobs/j1/review')) return json(200, { jobId: 'j1', status: 'review', reviewedAssetIds: ['slide-01'] });
    if (url.endsWith('/v1/jobs/j1/publish')) return json(201, { packId: 'hnsw-explainer', version: 3, packUrl: 'https://cdn.test/packs/hnsw-explainer/3.json' });
    if (url.endsWith('/v1/jobs/nope')) return json(404, { error: { code: 'not_found', message: 'no such job' } });
    return json(500, { error: { code: 'unexpected', message: url } });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('authoring client', () => {
  it('uploads through the presigned URL, starts the job, and walks review to publish with the Google ID token on every API call', async () => {
    const api = fakeApi();
    const client = createAuthoringClient('https://api.test/', 'tok', api.fetchImpl);
    const jobId = await client.submitDeck({ name: 'Deck.PPTX', type: '', body: new Blob(['x']) }, { packId: 'hnsw-explainer', title: 'HNSW' });
    expect(jobId).toBe('j1');
    expect(api.calls.map(c => `${c.method} ${c.url}`)).toEqual([
      'POST https://api.test/v1/uploads',
      'PUT https://decks.s3.amazonaws.com/uploads/u1/deck.pdf?sig',
      'POST https://api.test/v1/jobs',
    ]);
    expect(api.calls[0].body).toEqual({ filename: 'Deck.PPTX', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    expect(api.calls[1].headers.authorization).toBeUndefined();
    expect(api.calls[2].body).toEqual({ uploadId: 'u1', packId: 'hnsw-explainer', title: 'HNSW' });
    expect((await client.getJob('j1')).status).toBe('review');
    expect((await client.getDraft('j1')).assets.length).toBeGreaterThan(0);
    await client.review('j1', [{ assetId: 'slide-01' }]);
    expect(api.calls.at(-1)?.body).toEqual({ decisions: [{ assetId: 'slide-01' }] });
    expect(await client.publish('j1')).toEqual({ packId: 'hnsw-explainer', version: 3, packUrl: 'https://cdn.test/packs/hnsw-explainer/3.json' });
    for (const c of api.calls.filter(c => c.url.startsWith('https://api.test'))) expect(c.headers.authorization).toBe('Bearer tok');
  });

  it('surfaces the API error code and message', async () => {
    const client = createAuthoringClient('https://api.test', 'tok', fakeApi().fetchImpl);
    await expect(client.getJob('nope')).rejects.toMatchObject({ status: 404, code: 'not_found', message: 'no such job' });
  });

  it('refuses a file the API would not ingest before uploading anything', async () => {
    const api = fakeApi();
    const client = createAuthoringClient('https://api.test', 'tok', api.fetchImpl);
    await expect(client.submitDeck({ name: 'notes.key', type: '', body: new Blob() }, { packId: 'x', title: 'x' })).rejects.toBeInstanceOf(AuthoringApiError);
    expect(api.calls).toHaveLength(0);
  });

  it('maps deck names to the accepted content types and titles to pack ids', () => {
    expect(deckContentType('a.pdf')).toBe('application/pdf');
    expect(deckContentType('a.PPTX')).toContain('presentationml');
    expect(deckContentType('a.key')).toBeNull();
    expect(packIdFromTitle('How HNSW Works!')).toBe('how-hnsw-works');
    expect(packIdFromTitle('???')).toBe('lesson');
  });
});
