import { describe, expect, it } from 'vitest';
import { chunkPages } from './chunk';

describe('chunkPages', () => {
  it('keeps a short page as one verbatim chunk', () => {
    const text = 'Alpha\nBeta  gamma';
    expect(chunkPages([{ page: 1, text }])).toEqual([
      expect.objectContaining({ page: 1, charStart: 0, charEnd: text.length, text }),
    ]);
  });

  it('splits long pages at the target with the configured overlap', () => {
    const words = Array.from({ length: 1_300 }, (_, index) => `w${index}`);
    const text = words.join(' ');
    const chunks = chunkPages([{ page: 1, text }]);

    expect(chunks.length).toBe(2);
    expect(chunks[0].text.split(/\s+/u)).toHaveLength(700);
    expect(chunks[1].text.split(/\s+/u)).toHaveLength(700);
    expect(chunks[1].text.startsWith('w600 ')).toBe(true);
  });

  it('never crosses a page boundary', () => {
    const first = Array.from({ length: 800 }, (_, index) => `first${index}`).join(' ');
    const second = Array.from({ length: 800 }, (_, index) => `second${index}`).join(' ');
    const chunks = chunkPages([{ page: 1, text: first }, { page: 2, text: second }]);

    expect(chunks.every(chunk => chunk.page === 1
      ? chunk.text.includes('first') && !chunk.text.includes('second')
      : chunk.text.includes('second') && !chunk.text.includes('first'))).toBe(true);
  });

  it('char ranges slice back to the exact original text', () => {
    const text = 'one  two\nthree four';
    for (const chunk of chunkPages([{ page: 7, text }])) {
      expect(text.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text);
    }
  });

  it('has stable ids and omits empty pages', () => {
    const pages = [{ page: 3, text: 'kept text' }, { page: 4, text: '  \n\t' }];
    const first = chunkPages(pages);
    const second = chunkPages(pages);
    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
    expect(first[0].chunkId).toMatch(/^p3-c0-/u);
  });
});
