import { describe, expect, it, vi } from 'vitest';
import { retrieve, type RetrieveDeps } from './retrieve';

describe('retrieve', () => {
  it('embeds once, queries the profile index, converts cosine distance, and filters 0.35', async () => {
    const deps: RetrieveDeps = {
      embed: { embed: vi.fn(async () => [[1, 0]]) },
      vectors: {
        forProfile: vi.fn(() => ({ query: vi.fn(async () => [
          { key: 'good', distance: 0.1, metadata: { docId: 'd', page: 12, kind: 'notes', title: 'Course Notes' } },
          { key: 'bad', distance: 0.8, metadata: { docId: 'd', page: 3, kind: 'notes', title: 'Course Notes' } },
        ]) })),
      },
      chunks: {
        get: vi.fn(async (chunkId) => chunkId === 'good'
          ? { chunkId, docId: 'd', title: 'Course Notes', page: 12, text: 'The page twelve concept.' }
          : undefined),
      },
    };

    await expect(retrieve('profile-p', 'page twelve concept', 3, { kind: 'notes' }, deps)).resolves.toEqual([
      { chunkId: 'good', docId: 'd', title: 'Course Notes', page: 12, score: 0.9, text: 'The page twelve concept.' },
    ]);
    expect(deps.vectors).toMatchObject({ forProfile: expect.any(Function) });
    expect(deps.chunks.get).toHaveBeenCalledWith('good');
  });
});
