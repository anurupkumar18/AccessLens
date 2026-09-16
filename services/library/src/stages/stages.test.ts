import { describe, expect, it, vi } from 'vitest';
import { chunkStage } from './chunkStage';
import { embedStage } from './embedStage';
import { extractStage } from './extractStage';
import { verifyStage } from './verifyStage';

describe('library stages', () => {
  it('extracts typed pages through the adapter', async () => {
    const extractPages = vi.fn(async () => [{ page: 1, text: 'Page one' }]);
    await expect(extractStage({ path: '/tmp/doc.pdf' }, { extractPages })).resolves.toEqual({
      pages: [{ page: 1, text: 'Page one' }], pageCount: 1,
    });
  });

  it('chunks extracted pages', async () => {
    await expect(chunkStage({ pages: [{ page: 1, text: 'Page one' }] })).resolves.toMatchObject({
      chunks: [expect.objectContaining({ page: 1, text: 'Page one' })],
    });
  });

  it('embeds chunks and writes vectors in one stage', async () => {
    const put = vi.fn(async () => undefined);
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [1, 0]));
    await expect(embedStage({
      profileId: 'profile', docId: 'doc', kind: 'notes', title: 'Notes',
      chunks: [{ chunkId: 'p1-c0-a', page: 1, charStart: 0, charEnd: 4, text: 'text' }],
    }, { embed: { embed }, vectors: { put } })).resolves.toMatchObject({ vectorCount: 1 });
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('fails verification when page one is not retrieved', async () => {
    await expect(verifyStage({ profileId: 'profile', pageOneText: 'A sentence from page one.' }, {
      retrieve: vi.fn(async () => []),
    })).rejects.toThrow(/page 1/u);
  });
});
