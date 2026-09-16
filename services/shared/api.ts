// The authoring API contract, spec §7.1 and §9.6.
//
// The pipeline is an API first and the extension is only its first client, so
// this file -- not any handler, and not the extension -- is where a route's
// request and response shape is decided. The Lambdas validate against these
// schemas and `packages/contracts/authoring-api.openapi.yaml` is generated
// from them, with a test that fails if the committed document drifts. A
// dashboard, a CLI, or an LMS plugin reads the OpenAPI document and gets
// exactly what the extension gets.
import { z } from 'zod';
import { AccessPackSchema, ArtifactManifestSchema } from '../../apps/extension/src/shared/contracts';
import { JobStatusSchema, ReviewDecisionSchema, SlideProgressSchema } from './jobs';

const IanaTimeZoneSchema = z.string().min(1).max(80).refine(value => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
}, 'timeZone must be an IANA time zone.');

// ---------------------------------------------------------------------------
// Errors

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    slideId: z.string().min(1).optional(),
  }).strict(),
}).strict();
export type ApiError = z.infer<typeof ApiErrorSchema>;

// ---------------------------------------------------------------------------
// Uploads and jobs

export const CreateUploadRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.enum([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ]),
}).strict();

export const CreateUploadResponseSchema = z.object({
  uploadId: z.string().min(1),
  url: z.string().url(),
  expiresAt: z.string().datetime(),
}).strict();

export const CreateJobRequestSchema = z.object({
  uploadId: z.string().min(1),
  packId: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/, 'packId is lowercase kebab-case'),
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  // A job without a profile runs with no retrieval at all (spec §9.6).
  profileId: z.string().min(1).optional(),
  visualHints: z.array(z.object({
    slide: z.number().int().positive(),
    hint: z.string().min(1).max(500),
  }).strict()).max(100).optional(),
}).strict();

export const CreateJobResponseSchema = z.object({
  jobId: z.string().min(1),
  status: JobStatusSchema,
}).strict();

export const JobStatusResponseSchema = z.object({
  jobId: z.string().min(1),
  status: JobStatusSchema,
  packId: z.string().min(1),
  slides: z.array(SlideProgressSchema),
  error: z.string().optional(),
}).strict();

/** What the review UI, or `curl`, gets once a job reaches `review`. */
export const JobDraftResponseSchema = z.object({
  jobId: z.string().min(1),
  status: JobStatusSchema,
  pack: AccessPackSchema,
  visualizations: z.array(z.object({
    assetId: z.string().min(1),
    artifact: ArtifactManifestSchema,
    screenshotUrl: z.string().min(1),
    critique: z.string(),
  }).strict()),
}).strict();

export const ReviewRequestSchema = z.object({
  decisions: z.array(ReviewDecisionSchema).min(1),
}).strict();

export const ReviewResponseSchema = z.object({
  jobId: z.string().min(1),
  status: JobStatusSchema,
  reviewedAssetIds: z.array(z.string().min(1)),
}).strict();

export const PublishResponseSchema = z.object({
  packId: z.string().min(1),
  version: z.number().int().positive(),
  packUrl: z.string().url(),
}).strict();

// ---------------------------------------------------------------------------
// Published packs and artifacts

export const PackVersionsResponseSchema = z.object({
  packId: z.string().min(1),
  versions: z.array(z.object({
    version: z.number().int().positive(),
    publishedAt: z.string().datetime(),
    packUrl: z.string().url(),
  }).strict()),
}).strict();

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  version: z.string().min(1),
  region: z.string().min(1),
}).strict();

// ---------------------------------------------------------------------------
// Course profiles and the library, spec §9.6
//
// Charter-adjacent: these are the *instructor's* materials. No route below
// returns a whole document to anyone but the owning instructor, and the only
// thing that ever reaches a student is a capped quote with a citation.

/** Deliberately excludes student submissions, assessments, and answer keys. */
export const DocumentKindSchema = z.enum(['textbook', 'slides', 'notes', 'syllabus', 'reading', 'other']);

export const CreateProfileRequestSchema = z.object({
  name: z.string().min(1).max(200),
  subject: z.string().min(1).max(120),
  level: z.string().min(1).max(80),
  /** IANA timezone used to make due-date answers unambiguous. */
  timeZone: IanaTimeZoneSchema.default('UTC'),
}).strict();

export const DocumentRecordSchema = z.object({
  docId: z.string().min(1),
  profileId: z.string().min(1),
  kind: DocumentKindSchema,
  title: z.string().min(1).max(300),
  citation: z.string().max(600).optional(),
  pages: z.number().int().nonnegative(),
  chunks: z.number().int().nonnegative(),
  status: z.enum(['pending', 'extracting', 'chunking', 'embedding', 'verifying', 'ready', 'failed']),
  stage: z.string().optional(),
  error: z.string().optional(),
  indexedAt: z.string().datetime().optional(),
}).strict();
export type DocumentRecord = z.infer<typeof DocumentRecordSchema>;

export const ProfileRecordSchema = z.object({
  profileId: z.string().min(1),
  /** Google subject of the instructor who owns it (D13); every profile route is scoped to it. */
  ownerSub: z.string().min(1).optional(),
  name: z.string().min(1),
  subject: z.string().min(1),
  level: z.string().min(1),
  timeZone: IanaTimeZoneSchema.default('UTC'),
  archiveState: z.enum(['active', 'archived', 'deleting']).default('active'),
  createdAt: z.string().datetime(),
  vectorIndexName: z.string().min(1),
}).strict();
export type ProfileRecord = z.infer<typeof ProfileRecordSchema>;

export const ProfileResponseSchema = z.object({
  profile: ProfileRecordSchema,
  documents: z.array(DocumentRecordSchema),
}).strict();

export const RegisterDocumentRequestSchema = z.object({
  uploadId: z.string().min(1),
  kind: DocumentKindSchema,
  title: z.string().min(1).max(300),
  citation: z.string().max(600).optional(),
}).strict();

export const SearchRequestSchema = z.object({
  query: z.string().min(1).max(2000),
  k: z.number().int().positive().max(20).default(6),
  kind: DocumentKindSchema.optional(),
  docId: z.string().min(1).optional(),
}).strict();

/**
 * A search hit. `text` is the chunk verbatim as it was indexed -- this route
 * serves the owning instructor and the pipeline, never a student, which is why
 * it is allowed to be the full chunk rather than a capped quote.
 */
export const SearchHitSchema = z.object({
  chunkId: z.string().min(1),
  docId: z.string().min(1),
  title: z.string().min(1),
  page: z.number().int().positive(),
  score: z.number(),
  text: z.string(),
}).strict();

export const SearchResponseSchema = z.object({
  query: z.string().min(1),
  hits: z.array(SearchHitSchema),
}).strict();

export const DeletedResponseSchema = z.object({ deleted: z.literal(true), id: z.string().min(1) }).strict();

// ---------------------------------------------------------------------------
// Approval-gated class membership and cited student assistance (AL-056)

/**
 * A durable, instructor-visible record of a class purge. The record never
 * contains source material, student identities, questions, or answers.
 */
export const ClassDeletionJobSchema = z.object({
  jobId: z.string().min(1),
  profileId: z.string().min(1),
  status: z.enum(['queued', 'running', 'succeeded', 'failed']),
  requestedAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  /** Deliberately stable codes: worker errors must not expose course data. */
  error: z.enum(['dispatch_failed', 'purge_failed']).optional(),
}).strict();
export type ClassDeletionJob = z.infer<typeof ClassDeletionJobSchema>;
export const ClassDeletionJobResponseSchema = z.object({ deletion: ClassDeletionJobSchema }).strict();

export const ClassMembershipSchema = z.object({
  profileId: z.string().min(1),
  studentSub: z.string().min(1),
  role: z.literal('student'),
  joinedAt: z.string().datetime(),
}).strict();
export type ClassMembership = z.infer<typeof ClassMembershipSchema>;

export const ClassInviteSchema = z.object({
  inviteId: z.string().min(1),
  profileId: z.string().min(1),
  token: z.string().min(16),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  maxRedemptions: z.number().int().positive(),
  redemptions: z.number().int().nonnegative(),
  revokedAt: z.string().datetime().optional(),
}).strict();
export type ClassInvite = z.infer<typeof ClassInviteSchema>;

export const CreateInviteRequestSchema = z.object({
  expiresInHours: z.number().int().positive().max(24 * 30).default(72),
  maxRedemptions: z.number().int().positive().max(500).default(1),
}).strict();
export const CreateInviteResponseSchema = z.object({
  invite: ClassInviteSchema,
}).strict();
export const RedeemInviteRequestSchema = z.object({ token: z.string().min(16).max(256) }).strict();
export const RedeemInviteResponseSchema = z.object({ membership: ClassMembershipSchema }).strict();
export const RevokeInviteResponseSchema = z.object({ invite: ClassInviteSchema }).strict();

export const FactCitationSchema = z.object({
  docId: z.string().min(1),
  title: z.string().min(1),
  page: z.number().int().positive(),
  quote: z.string().min(1).max(300),
}).strict();
export type FactCitation = z.infer<typeof FactCitationSchema>;

export const ClassFactSchema = z.object({
  factId: z.string().min(1),
  profileId: z.string().min(1),
  kind: z.enum(['deadline', 'recap']),
  status: z.enum(['draft', 'published', 'superseded']),
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(1200),
  occurredOn: z.string().date().optional(),
  dueAt: z.string().datetime().optional(),
  timeZone: IanaTimeZoneSchema,
  citation: FactCitationSchema,
  createdAt: z.string().datetime(),
  publishedAt: z.string().datetime().optional(),
  supersedesFactId: z.string().min(1).optional(),
}).strict().superRefine((fact, context) => {
  if (fact.kind === 'deadline' && !fact.dueAt) context.addIssue({ code: 'custom', message: 'Deadline facts require dueAt.', path: ['dueAt'] });
  if (fact.kind === 'recap' && !fact.occurredOn) context.addIssue({ code: 'custom', message: 'Recap facts require occurredOn.', path: ['occurredOn'] });
});
export type ClassFact = z.infer<typeof ClassFactSchema>;

export const CreateFactRequestSchema = z.object({
  kind: z.enum(['deadline', 'recap']),
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(1200),
  occurredOn: z.string().date().optional(),
  dueAt: z.string().datetime().optional(),
  timeZone: IanaTimeZoneSchema,
  citation: FactCitationSchema,
}).strict().superRefine((fact, context) => {
  if (fact.kind === 'deadline' && !fact.dueAt) context.addIssue({ code: 'custom', message: 'Deadline facts require dueAt.', path: ['dueAt'] });
  if (fact.kind === 'recap' && !fact.occurredOn) context.addIssue({ code: 'custom', message: 'Recap facts require occurredOn.', path: ['occurredOn'] });
});

export const ClassFactResponseSchema = z.object({ fact: ClassFactSchema }).strict();
export const PublishFactResponseSchema = z.object({ fact: ClassFactSchema }).strict();

export const StudentAskRequestSchema = z.object({ question: z.string().min(3).max(300) }).strict();
export const StudentCitationSchema = FactCitationSchema.extend({ kind: z.enum(['fact', 'document']), provisional: z.boolean() }).strict();
export const StudentAskResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('answered'), answer: z.string().min(1).max(700), citations: z.array(StudentCitationSchema).min(1), provisional: z.boolean() }).strict(),
  z.object({ status: z.literal('declined'), reason: z.enum(['course-assistant-disabled', 'not-supported-by-material', 'class-archived', 'model-unavailable']) }).strict(),
]);

/**
 * The signed-in instructor's own record (D13). Created on first sign-in;
 * anybody with a verified Google account may create one for now. This is the
 * only identity the service stores and it is never a student's.
 */
export const InstructorRecordSchema = z.object({
  sub: z.string().min(1),
  email: z.string().min(3),
  name: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
}).strict();
export type InstructorRecord = z.infer<typeof InstructorRecordSchema>;

/** One pack this instructor published: the latest version per pack id, ready to present. */
export const PublishedPackSummarySchema = z.object({
  packId: z.string().min(1),
  title: z.string().min(1),
  version: z.number().int().positive(),
  packUrl: z.string().url(),
  publishedAt: z.string().datetime(),
}).strict();
export type PublishedPackSummary = z.infer<typeof PublishedPackSummarySchema>;

export const MeResponseSchema = z.object({
  instructor: InstructorRecordSchema,
  /** Every course profile this instructor owns, newest first. */
  profiles: z.array(ProfileRecordSchema),
  /** Every pack this instructor has published, newest first, one entry per pack id. */
  packs: z.array(PublishedPackSummarySchema),
}).strict();

// ---------------------------------------------------------------------------
// The route table. This array is the single source the OpenAPI generator walks,
// so a route that exists in the API and not here cannot be documented, and a
// route documented here and not deployed fails the drift test.

export interface RouteSpec {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  operationId: string;
  summary: string;
  request?: z.ZodTypeAny;
  response: z.ZodTypeAny;
  successStatus: 200 | 201 | 202;
  /** A Google ID token as a bearer (D12). Static CloudFront delivery means students never need one. */
  auth: 'bearer';
}

export const ROUTES: RouteSpec[] = [
  { method: 'GET',  path: '/v1/health', operationId: 'getHealth', summary: 'Liveness and deployed version', response: HealthResponseSchema, successStatus: 200, auth: 'bearer' },
  { method: 'GET',  path: '/v1/me', operationId: 'getMe', summary: 'The signed-in instructor, created on first call, with their course profiles and published packs', response: MeResponseSchema, successStatus: 200, auth: 'bearer' },

  { method: 'POST', path: '/v1/uploads', operationId: 'createUpload', summary: 'Get a presigned PUT URL for a deck or a library document', request: CreateUploadRequestSchema, response: CreateUploadResponseSchema, successStatus: 200, auth: 'bearer' },
  { method: 'POST', path: '/v1/jobs', operationId: 'createJob', summary: 'Start an authoring job on an uploaded deck', request: CreateJobRequestSchema, response: CreateJobResponseSchema, successStatus: 202, auth: 'bearer' },
  { method: 'GET',  path: '/v1/jobs/{jobId}', operationId: 'getJob', summary: 'Job and per-slide status', response: JobStatusResponseSchema, successStatus: 200, auth: 'bearer' },
  { method: 'GET',  path: '/v1/jobs/{jobId}/draft', operationId: 'getJobDraft', summary: 'The full draft for review, once status is review', response: JobDraftResponseSchema, successStatus: 200, auth: 'bearer' },
  { method: 'POST', path: '/v1/jobs/{jobId}/review', operationId: 'reviewJob', summary: 'Apply instructor edits and decisions', request: ReviewRequestSchema, response: ReviewResponseSchema, successStatus: 200, auth: 'bearer' },
  { method: 'POST', path: '/v1/jobs/{jobId}/publish', operationId: 'publishJob', summary: 'Publish the approved draft as the next pack version', response: PublishResponseSchema, successStatus: 201, auth: 'bearer' },

  { method: 'GET',  path: '/v1/packs/{packId}', operationId: 'listPackVersions', summary: 'List published versions', response: PackVersionsResponseSchema, successStatus: 200, auth: 'bearer' },
  { method: 'GET',  path: '/v1/packs/{packId}/{version}', operationId: 'getPack', summary: 'Fetch a published pack', response: AccessPackSchema, successStatus: 200, auth: 'bearer' },
  { method: 'GET',  path: '/v1/artifacts/{artifactId}/{artifactVersion}/manifest', operationId: 'getArtifactManifest', summary: 'Fetch an artifact manifest', response: ArtifactManifestSchema, successStatus: 200, auth: 'bearer' },

  { method: 'POST',   path: '/v1/profiles', operationId: 'createProfile', summary: 'Create a course profile', request: CreateProfileRequestSchema, response: ProfileResponseSchema, successStatus: 201, auth: 'bearer' },
  { method: 'GET',    path: '/v1/profiles/{profileId}', operationId: 'getProfile', summary: 'Profile with document list and index status', response: ProfileResponseSchema, successStatus: 200, auth: 'bearer' },
  { method: 'DELETE', path: '/v1/profiles/{profileId}', operationId: 'deleteProfile', summary: 'Immediately archive a class and queue its durable source, vector, and metadata purge', response: ClassDeletionJobResponseSchema, successStatus: 202, auth: 'bearer' },
  { method: 'GET',    path: '/v1/profiles/{profileId}/deletion', operationId: 'getDeletionJob', summary: 'Read durable purge status for an archived class', response: ClassDeletionJobResponseSchema, successStatus: 200, auth: 'bearer' },
  { method: 'POST',   path: '/v1/profiles/{profileId}/documents', operationId: 'registerDocument', summary: 'Register an uploaded file and start indexing', request: RegisterDocumentRequestSchema, response: DocumentRecordSchema, successStatus: 202, auth: 'bearer' },
  { method: 'GET',    path: '/v1/profiles/{profileId}/documents/{docId}', operationId: 'getDocument', summary: 'Document status and page count', response: DocumentRecordSchema, successStatus: 200, auth: 'bearer' },
  { method: 'DELETE', path: '/v1/profiles/{profileId}/documents/{docId}', operationId: 'deleteDocument', summary: 'Remove the document and its vectors', response: DeletedResponseSchema, successStatus: 200, auth: 'bearer' },
  { method: 'POST',   path: '/v1/profiles/{profileId}/search', operationId: 'searchProfile', summary: 'Ranked chunks with citations', request: SearchRequestSchema, response: SearchResponseSchema, successStatus: 200, auth: 'bearer' },
  { method: 'POST',   path: '/v1/profiles/{profileId}/invites', operationId: 'createInvite', summary: 'Create an expiring student invite', request: CreateInviteRequestSchema, response: CreateInviteResponseSchema, successStatus: 201, auth: 'bearer' },
  { method: 'DELETE', path: '/v1/profiles/{profileId}/invites/{inviteId}', operationId: 'revokeInvite', summary: 'Revoke an unredeemed or active student invite', response: RevokeInviteResponseSchema, successStatus: 200, auth: 'bearer' },
  { method: 'POST',   path: '/v1/invites/redeem', operationId: 'redeemInvite', summary: 'Redeem an invite for the signed-in student', request: RedeemInviteRequestSchema, response: RedeemInviteResponseSchema, successStatus: 201, auth: 'bearer' },
  { method: 'POST',   path: '/v1/profiles/{profileId}/archive', operationId: 'archiveProfile', summary: 'Archive a class and revoke student access', response: ProfileResponseSchema, successStatus: 200, auth: 'bearer' },
  { method: 'POST',   path: '/v1/profiles/{profileId}/facts', operationId: 'createFact', summary: 'Create a cited provisional class fact', request: CreateFactRequestSchema, response: ClassFactResponseSchema, successStatus: 201, auth: 'bearer' },
  { method: 'POST',   path: '/v1/profiles/{profileId}/facts/{factId}/publish', operationId: 'publishFact', summary: 'Publish a reviewed class fact', response: PublishFactResponseSchema, successStatus: 200, auth: 'bearer' },
  { method: 'POST',   path: '/v1/student/profiles/{profileId}/ask', operationId: 'studentAsk', summary: 'Answer from this class only with citations or a decline', request: StudentAskRequestSchema, response: StudentAskResponseSchema, successStatus: 200, auth: 'bearer' },
];
