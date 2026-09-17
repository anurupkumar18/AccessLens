import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  classes: new Map<string, Record<string, unknown>>(),
  items: new Map<string, Record<string, unknown>>(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async (_client: unknown, command: { input: { Key: string } }) => `https://signed.example/${command.input.Key}`),
}));

vi.mock('../src/store.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/store.js')>();
  return {
    ...actual,
    s3: { send: vi.fn(async () => ({ Contents: [] })) },
    putClass: vi.fn(async (record: Record<string, unknown>) => {
      if (store.classes.has(record['classCode'] as string)) return false;
      store.classes.set(record['classCode'] as string, record);
      return true;
    }),
    getClass: vi.fn(async (code: string) => store.classes.get(code)),
    putItem: vi.fn(async (record: Record<string, unknown>) => { store.items.set(`${record['classCode']}/${record['itemId']}`, record); }),
    getItem: vi.fn(async (code: string, id: string) => store.items.get(`${code}/${id}`)),
    listItems: vi.fn(async (code: string) => [...store.items.values()].filter(i => i['classCode'] === code)),
    deleteItemRecord: vi.fn(async (code: string, id: string) => { store.items.delete(`${code}/${id}`); }),
    readText: vi.fn(async () => JSON.stringify({
      version: 1, itemId: 'x', fileName: 'deck.pptx', kind: 'document',
      document: { pages: [{ number: 1, imageKey: 'derived/p1.jpg', description: 'd', text: 't', figures: [] }] },
    })),
  };
});

import { contentTypeFor, handler } from '../src/api.js';

const call = async (body: unknown) => {
  const result = await handler({ requestContext: { http: { method: 'POST' } }, body: JSON.stringify(body) });
  return { status: result.statusCode, body: JSON.parse(result.body || '{}') as Record<string, any> };
};

beforeEach(() => {
  store.classes.clear();
  store.items.clear();
});

describe('course media API', () => {
  it('creates a class and stores only a hash of the instructor key', async () => {
    const { status, body } = await call({ action: 'createClass', title: 'BIOL 1210' });
    expect(status).toBe(200);
    expect(body.classCode).toMatch(/^[A-Z0-9]{8}$/);
    const stored = store.classes.get(body.classCode)!;
    expect(stored['keyHash']).not.toBe(body.instructorKey);
    expect(JSON.stringify(stored)).not.toContain(body.instructorKey);
  });

  it('issues an upload URL only to the class key, for supported files', async () => {
    const { body: made } = await call({ action: 'createClass', title: 'Chem' });
    expect((await call({ action: 'uploadUrl', classCode: made.classCode, instructorKey: 'wrong', fileName: 'a.pdf', size: 10 })).status).toBe(403);
    expect((await call({ action: 'uploadUrl', classCode: made.classCode, instructorKey: made.instructorKey, fileName: 'a.zip', size: 10 })).status).toBe(400);

    const ok = await call({ action: 'uploadUrl', classCode: made.classCode, instructorKey: made.instructorKey, fileName: 'Week 3.pptx', size: 2048 });
    expect(ok.status).toBe(200);
    expect(ok.body.uploadUrl).toBe(`https://signed.example/uploads/${made.classCode}/${ok.body.itemId}/Week-3.pptx`);
    expect(store.items.get(`${made.classCode}/${ok.body.itemId}`)).toMatchObject({ status: 'uploading', kind: 'document' });
  });

  it('lets students list with just the code, typed loosely', async () => {
    const { body: made } = await call({ action: 'createClass', title: 'Physics' });
    await call({ action: 'uploadUrl', classCode: made.classCode, instructorKey: made.instructorKey, fileName: 'talk.mp4', size: 99 });
    const loose = `${made.classCode.slice(0, 4).toLowerCase()}-${made.classCode.slice(4)}`;
    const { status, body } = await call({ action: 'list', classCode: loose });
    expect(status).toBe(200);
    expect(body.title).toBe('Physics');
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).not.toHaveProperty('sizeBytes');
    expect((await call({ action: 'list', classCode: 'ZZZZZZZZ' })).status).toBe(404);
  });

  it('returns a ready item with presigned URLs for everything it references', async () => {
    const { body: made } = await call({ action: 'createClass' });
    const up = await call({ action: 'uploadUrl', classCode: made.classCode, instructorKey: made.instructorKey, fileName: 'deck.pptx', size: 5 });
    const pending = await call({ action: 'get', classCode: made.classCode, itemId: up.body.itemId });
    expect(pending.body.manifest).toBeUndefined();

    store.items.get(`${made.classCode}/${up.body.itemId}`)!['status'] = 'ready';
    const ready = await call({ action: 'get', classCode: made.classCode, itemId: up.body.itemId });
    expect(ready.body.urls).toEqual({ 'derived/p1.jpg': 'https://signed.example/derived/p1.jpg' });
  });

  it('deletes only with the instructor key', async () => {
    const { body: made } = await call({ action: 'createClass' });
    const up = await call({ action: 'uploadUrl', classCode: made.classCode, instructorKey: made.instructorKey, fileName: 'x.png', size: 5 });
    expect((await call({ action: 'delete', classCode: made.classCode, itemId: up.body.itemId })).status).toBe(403);
    expect((await call({ action: 'delete', classCode: made.classCode, instructorKey: made.instructorKey, itemId: up.body.itemId })).status).toBe(200);
    expect(store.items.size).toBe(0);
  });
});

describe('contentTypeFor', () => {
  it('gives caption tracks and media the types browsers require', () => {
    expect(contentTypeFor('derived/X/transcribe/accesslens-X.vtt')).toBe('text/vtt');
    expect(contentTypeFor('uploads/X/Y/Podcast.MP3')).toBe('audio/mpeg');
    expect(contentTypeFor('derived/X/pages/0001.jpg')).toBe('image/jpeg');
    expect(contentTypeFor('derived/X/manifest.json')).toBeUndefined();
  });
});
