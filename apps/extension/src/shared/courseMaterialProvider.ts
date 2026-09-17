import { z } from 'zod';

/** The only course-material categories a future institution may explicitly allow. */
export const AllowedCourseMaterialKindSchema = z.enum([
  'syllabus',
  'module',
  'slide-deck',
  'reference-document',
]);

const ReviewedId = z.string().min(1).max(160).regex(/^[A-Za-z0-9._:/-]+$/, 'must be an approved identifier');

/**
 * References are intentionally content-free. A Canvas/LTI adapter must live in
 * an approved backend and cannot use this extension seam to receive a document,
 * token, student record, submission, grade, or answer key.
 */
export const CourseMaterialReferenceSchema = z.object({
  courseId: ReviewedId,
  materialId: ReviewedId,
  kind: AllowedCourseMaterialKindSchema,
  revision: ReviewedId,
}).strict();

export const CourseMaterialLookupSchema = z.object({
  courseId: ReviewedId,
  references: z.array(CourseMaterialReferenceSchema).min(1).max(50),
}).strict().superRefine((value, context) => {
  value.references.forEach((reference, index) => {
    if (reference.courseId !== value.courseId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['references', index, 'courseId'], message: 'reference must belong to the requested course' });
    }
  });
});

export type CourseMaterialReference = z.infer<typeof CourseMaterialReferenceSchema>;
export type CourseMaterialLookup = z.infer<typeof CourseMaterialLookupSchema>;

export class CourseMaterialProviderDisabledError extends Error {
  constructor() {
    super('Course-material retrieval is disabled. The reviewed-pack demo remains available without Canvas or RAG.');
    this.name = 'CourseMaterialProviderDisabledError';
  }
}

export interface CourseMaterialProvider {
  readonly state: 'disabled' | 'enabled';
  retrieveApprovedReferences(request: CourseMaterialLookup): Promise<never>;
}

/** The extension ships no Canvas/LTI client, token handling, or course retrieval. */
export const disabledCourseMaterialProvider: CourseMaterialProvider = {
  state: 'disabled',
  async retrieveApprovedReferences(request) {
    CourseMaterialLookupSchema.parse(request);
    throw new CourseMaterialProviderDisabledError();
  },
};

export function createCourseMaterialProvider(): CourseMaterialProvider {
  return disabledCourseMaterialProvider;
}
