import { describe, expect, it } from 'vitest';
import {
  CourseMaterialLookupSchema,
  CourseMaterialProviderDisabledError,
  createCourseMaterialProvider,
  type CourseMaterialLookup,
} from './courseMaterialProvider';

describe('disabled course-material provider', () => {
  const request: CourseMaterialLookup = {
    courseId: 'course:biology-101',
    references: [{ courseId: 'course:biology-101', materialId: 'module:cell-structure', kind: 'module', revision: 'v1' }],
  };

  it('is disabled by construction and cannot retrieve a course material', async () => {
    const provider = createCourseMaterialProvider();
    expect(provider.state).toBe('disabled');
    await expect(provider.retrieveApprovedReferences(request)).rejects.toBeInstanceOf(CourseMaterialProviderDisabledError);
  });

  it.each([
    ['an excluded assignment', { ...request, references: [{ ...request.references[0], kind: 'assignment' }] }],
    ['raw course content', { ...request, sourceText: 'private lecture document' }],
    ['a Canvas credential', { ...request, canvasAccessToken: 'secret-token' }],
    ['student information', { ...request, studentId: 'student-7' }],
    ['a foreign-course reference', { ...request, references: [{ ...request.references[0], courseId: 'course:other' }] }],
  ])('rejects %s before a future adapter could receive it', (_label, value) => {
    expect(CourseMaterialLookupSchema.safeParse(value).success).toBe(false);
  });
});
