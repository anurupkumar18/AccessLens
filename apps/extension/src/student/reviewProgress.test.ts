import { beforeEach, describe, expect, it } from 'vitest';
import { loadReviewProgress, resetReviewProgressForTests, saveReviewProgress } from './reviewProgress';

describe('explicit local review progress', () => {
  beforeEach(() => resetReviewProgressForTests());

  it('keeps student-marked concepts local to one reviewed pack', async () => {
    await saveReviewProgress('bio-cell-demo', ['cell-slide-03:mitochondrion']);
    expect(await loadReviewProgress('bio-cell-demo')).toEqual(['cell-slide-03:mitochondrion']);
    expect(await loadReviewProgress('different-reviewed-pack')).toEqual([]);
  });

  it('rejects an invalid or unbounded concept list', async () => {
    await expect(saveReviewProgress('bio-cell-demo', [''])).rejects.toThrow();
    await expect(saveReviewProgress('bio-cell-demo', Array.from({ length: 101 }, (_, index) => `concept-${index}`))).rejects.toThrow();
  });
});
