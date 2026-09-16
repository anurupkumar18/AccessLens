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

export const DocumentKindSchema = z.enum(['textbook', 'slides', 'notes', 'problems', 'syllabus', 'other']);

export const CreateProfileRequestSchema = z.object({
  name: z.string().min(1).max(200),
  subject: z.string().min(1).max(120),
  level: z.string().min(1).max(80),
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
  name: z.string().min(1),
  subject: z.string().min(1),
  level: z.string().min(1),
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
  /** Static CloudFront delivery means a render-only client never needs the token. */
  auth: 'bearer';
}

export const ROUTES: RouteSpec[] = [
  { method: 'GET',  path: '/v1/health', operationId: 'getHealth', summary: 'Liveness and deployed version', response: HealthResponseSchema, successStatus: 200, auth: 'bearer' },

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
  { method: 'DELETE', path: '/v1/profiles/{profileId}', operationId: 'deleteProfile', summary: 'Delete the profile, its documents, files, and vectors', response: DeletedResponseSchema, successStatus: 200, auth: 'bearer' },
  { method: 'POST',   path: '/v1/profiles/{profileId}/documents', operationId: 'registerDocument', summary: 'Register an uploaded file and start indexing', request: RegisterDocumentRequestSchema, response: DocumentRecordSchema, successStatus: 202, auth: 'bearer' },
  { method: 'GET',    path: '/v1/profiles/{profileId}/documents/{docId}', operationId: 'getDocument', summary: 'Document status and page count', response: DocumentRecordSchema, successStatus: 200, auth: 'bearer' },
  { method: 'DELETE', path: '/v1/profiles/{profileId}/documents/{docId}', operationId: 'deleteDocument', summary: 'Remove the document and its vectors', response: DeletedResponseSchema, successStatus: 200, auth: 'bearer' },
  { method: 'POST',   path: '/v1/profiles/{profileId}/search', operationId: 'searchProfile', summary: 'Ranked chunks with citations', request: SearchRequestSchema, response: SearchResponseSchema, successStatus: 200, auth: 'bearer' },
];
