import { describe, expect, it, vi } from 'vitest';
import { indexDocument } from './indexDocument';

describe('indexDocument', () => {
  it('runs extract, chunk, embed, verify and marks the document ready', async () => {
    const updates: unknown[] = [];
    const result = await indexDocument({ profileId: 'p', docId: 'd', path: 'doc.pdf', kind: 'notes', title: 'Notes' }, {
      update: vi.fn(async (record) => { updates.push(record); }),
      extractPages: vi.fn(async () => [{ page: 1, text: 'A page one sentence.' }]),
      embed: { embed: vi.fn(async (texts: readonly string[]) => texts.map(() => Array.from({ length: 1024 }, () => 1))) },
      vectors: { put: vi.fn(async () => undefined) },
      chunks: { put: vi.fn(async () => undefined), get: vi.fn(async () => undefined) },
      retrieve: vi.fn(async () => [{ chunkId: 'd:p1-c0', docId: 'd', title: 'Notes', page: 1, score: .9, text: 'A page one sentence.' }]),
    });
    expect(result.status).toBe('ready');
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'extracting' }),
      expect.objectContaining({ status: 'chunking' }),
      expect.objectContaining({ status: 'embedding' }),
      expect.objectContaining({ status: 'verifying' }),
      expect.objectContaining({ status: 'ready' }),
    ]));
  });

  it('records failed verification and preserves the profile flow', async () => {
    const update = vi.fn(async () => undefined);
    await expect(indexDocument({ profileId: 'p', docId: 'd', path: 'doc.pdf', kind: 'notes', title: 'Notes' }, {
      update,
      extractPages: vi.fn(async () => [{ page: 1, text: 'A page one sentence.' }]),
      embed: { embed: vi.fn(async (texts: readonly string[]) => texts.map(() => Array.from({ length: 1024 }, () => 1))) },
      vectors: { put: vi.fn(async () => undefined) },
      chunks: { put: vi.fn(async () => undefined), get: vi.fn(async () => undefined) },
      retrieve: vi.fn(async () => []),
    })).rejects.toThrow(/failed at verify/u);
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed', stage: 'verify' }));
  });
});
