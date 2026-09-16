import { describe, it, expect } from 'vitest';
import { deckWindows, retrieveForEvent } from './retrieveHandler';
import type { RetrieveDeps } from './retrieve';

function fakeDeps(hitsFor: (query: string) => Array<{ key: string; distance: number; page: number }>): RetrieveDeps & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    embed: { async embed(texts) { queries.push(...texts); return texts.map(text => [text.length]); } },
    vectors: { async query(vector) {
      const query = queries.find(q => q.length === vector[0]) ?? '';
      return hitsFor(query).map(hit => ({ key: hit.key, distance: hit.distance, metadata: { docId: 'doc', page: hit.page } }));
    } },
    chunks: { async get(chunkId) { return { chunkId, docId: 'doc', title: 'Textbook', page: Number(chunkId.split(':p')[1]) || 1, text: `text of ${chunkId}` }; } },
  };
}

describe('deckWindows', () => {
  it('splits the deck into at most three contiguous windows and drops empty slides', () => {
    expect(deckWindows([{ extractedText: 'a' }, { extractedText: ' ' }, { extractedText: 'b' }, { extractedText: 'c' }, { extractedText: 'd' }])).toEqual(['a\n\nb', 'c\n\nd']);
    expect(deckWindows(Array.from({ length: 9 }, (_, i) => ({ extractedText: `s${i}` })))).toHaveLength(3);
    expect(deckWindows([{}, { extractedText: '' }])).toEqual([]);
  });
});

describe('retrieveForEvent', () => {
  it('queries each deck window, merges hits by chunk keeping the best score, and caps at k', async () => {
    const deps = fakeDeps(query => query.startsWith('w1')
      ? [{ key: 'doc:p1', distance: 0.1, page: 1 }, { key: 'doc:p2', distance: 0.5, page: 2 }]
      : [{ key: 'doc:p1', distance: 0.4, page: 1 }, { key: 'doc:p3', distance: 0.2, page: 3 }]);
    const result = await retrieveForEvent({ profileId: 'prof', slides: [{ extractedText: 'w1 alpha' }, { extractedText: 'w2 beta' }], k: 2 }, deps);
    expect(deps.queries).toEqual(['w1 alpha', 'w2 beta']);
    expect(result.excerpts.map(e => [e.chunkId, e.score])).toEqual([['doc:p1', 0.9], ['doc:p3', 0.8]]);
  });

  it('runs a single slide query with k=4 by default and drops hits under the similarity floor', async () => {
    const deps = fakeDeps(() => [{ key: 'doc:p5', distance: 0.3, page: 5 }, { key: 'doc:p6', distance: 0.9, page: 6 }]);
    const result = await retrieveForEvent({ profileId: 'prof', query: 'the slide text' }, deps);
    expect(result.excerpts.map(e => e.page)).toEqual([5]);
    expect(deps.queries).toEqual(['the slide text']);
  });

  it('returns nothing for an empty slide instead of embedding whitespace', async () => {
    const deps = fakeDeps(() => [{ key: 'x', distance: 0, page: 1 }]);
    expect((await retrieveForEvent({ profileId: 'prof', query: '   ' }, deps)).excerpts).toEqual([]);
    expect(deps.queries).toEqual([]);
  });
});
