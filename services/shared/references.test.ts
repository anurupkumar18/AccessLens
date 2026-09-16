import { describe, it, expect } from 'vitest';
import { verifyReferences, normaliseForMatch, type Excerpt } from './references';

const excerpt = (over: Partial<Excerpt> = {}): Excerpt => ({
  chunkId: 'c1', docId: 'hnsw-paper', title: 'HNSW', page: 4, score: 0.8,
  text: 'The search starts from the top layer\nand greedily traverses the graph until a local minimum is reached.',
  ...over,
});

describe('verifyReferences keeps only what the model was actually shown', () => {
  it('keeps a quote that appears verbatim in an excerpt from the cited page', () => {
    const { kept, dropped } = verifyReferences(
      [{ docId: 'hnsw-paper', page: 4, quote: 'greedily traverses the graph' }],
      [excerpt()],
    );
    expect(dropped).toEqual([]);
    expect(kept).toEqual([{ docId: 'hnsw-paper', title: 'HNSW', page: 4, quote: 'greedily traverses the graph' }]);
  });

  it('drops a paraphrase, however plausible', () => {
    const { kept, dropped } = verifyReferences(
      [{ docId: 'hnsw-paper', page: 4, quote: 'greedily walks the graph' }],
      [excerpt()],
    );
    expect(kept).toEqual([]);
    expect(dropped[0].reason).toBe('quote-not-verbatim-in-excerpt');
  });

  it('drops a real quote cited to the wrong page, because it sends the student to the wrong place', () => {
    const { kept, dropped } = verifyReferences(
      [{ docId: 'hnsw-paper', page: 12, quote: 'greedily traverses the graph' }],
      [excerpt({ page: 4 })],
    );
    expect(kept).toEqual([]);
    expect(dropped[0].reason).toBe('no-excerpt-for-doc-and-page');
  });

  it('drops a quote attributed to a document that was never in this call', () => {
    const { dropped } = verifyReferences(
      [{ docId: 'some-textbook', page: 4, quote: 'greedily traverses the graph' }],
      [excerpt()],
    );
    expect(dropped[0].reason).toBe('no-excerpt-for-doc-and-page');
  });

  it('matches across the line break that pdftotext left in the middle of a sentence', () => {
    const { kept } = verifyReferences(
      [{ docId: 'hnsw-paper', page: 4, quote: 'the top layer and greedily traverses' }],
      [excerpt()],
    );
    expect(kept).toHaveLength(1);
  });

  it('still rejects a single changed number, which reflowing must never hide', () => {
    const { kept } = verifyReferences(
      [{ docId: 'p', page: 1, quote: 'ef is set to 64' }],
      [excerpt({ docId: 'p', page: 1, text: 'In our experiments ef is set to 32 for all runs.' })],
    );
    expect(kept).toEqual([]);
  });

  it('caps a surviving quote at the pack contract length', () => {
    const long = 'x'.repeat(400);
    const { kept } = verifyReferences(
      [{ docId: 'p', page: 1, quote: long }],
      [excerpt({ docId: 'p', page: 1, text: long })],
    );
    expect(kept[0].quote).toHaveLength(300);
  });

  it('takes the title from the excerpt, never from the model', () => {
    const { kept } = verifyReferences(
      [{ docId: 'p', page: 1, quote: 'real text' }],
      [excerpt({ docId: 'p', page: 1, title: 'The Real Title', text: 'some real text here' })],
    );
    expect(kept[0].title).toBe('The Real Title');
  });

  it('deduplicates two claims that resolve to the same citation', () => {
    const { kept } = verifyReferences(
      [{ docId: 'p', page: 1, quote: 'real text' }, { docId: 'p', page: 1, quote: 'real  text' }],
      [excerpt({ docId: 'p', page: 1, text: 'some real text here' })],
    );
    expect(kept).toHaveLength(1);
  });

  it('keeps nothing at all when no excerpts were supplied', () => {
    const { kept, dropped } = verifyReferences([{ docId: 'p', page: 1, quote: 'anything' }], []);
    expect(kept).toEqual([]);
    expect(dropped).toHaveLength(1);
  });

  it('is a no-op on an empty claim list', () => {
    expect(verifyReferences([], [excerpt()])).toEqual({ kept: [], dropped: [] });
  });
});

describe('normaliseForMatch', () => {
  it('collapses every run of whitespace and trims', () => {
    expect(normaliseForMatch('  a\n\t b   c ')).toBe('a b c');
  });

  it('changes nothing else', () => {
    expect(normaliseForMatch('ef=32, M=16 (Malkov & Yashunin)')).toBe('ef=32, M=16 (Malkov & Yashunin)');
  });
});
