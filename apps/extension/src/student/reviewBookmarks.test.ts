import { beforeEach, describe, expect, it } from 'vitest';
import { loadReviewBookmarks, resetReviewBookmarksForTests, saveReviewBookmarks } from './reviewBookmarks';

describe('review bookmarks', () => {
  beforeEach(() => resetReviewBookmarksForTests());

  it('keeps concept bookmarks local to one reviewed pack', async () => {
    await saveReviewBookmarks('bio-cell-demo', ['cell-slide-03:mitochondrion']);
    expect(await loadReviewBookmarks('bio-cell-demo')).toEqual(['cell-slide-03:mitochondrion']);
    expect(await loadReviewBookmarks('another-reviewed-pack')).toEqual([]);
  });

  it('rejects non-concept bookmark data', async () => {
    await expect(saveReviewBookmarks('bio-cell-demo', ['ok', ''])).rejects.toThrow();
  });
});
