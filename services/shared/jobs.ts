// Job and review state for the authoring pipeline.
//
// One DynamoDB item per job plus one per slide, TTL 7 days (spec §8). These
// schemas are the shape of those items and of everything the API returns about
// them, so a client polling `GET /v1/jobs/{id}` and a Step Functions stage
// writing progress agree by construction rather than by convention.
//
// Charter A4: nothing here identifies a student. The server knows about the
// instructor's job and the pack it produces; it has no reason to know a
// student exists, and no field below gives it one.
import { z } from 'zod';

/** Job lifecycle, spec §7.1. `needs_input` means a stage exhausted its retries. */
export const JobStatusSchema = z.enum([
  'queued', 'ingesting', 'describing', 'visualizing',
  'review', 'publishing', 'published', 'failed', 'needs_input',
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

/** Per-slide stage names mirror the pipeline stages in spec §8. */
export const SlideStageSchema = z.enum([
  'ingest', 'describe', 'audio', 'plan', 'retrieve', 'adapt', 'generate', 'critique', 'done',
]);
export type SlideStage = z.infer<typeof SlideStageSchema>;

export const SlideStatusSchema = z.enum(['pending', 'running', 'ok', 'needs_review', 'no_visual', 'failed']);

export const SlideProgressSchema = z.object({
  assetId: z.string().min(1),
  stage: SlideStageSchema,
  status: SlideStatusSchema,
  error: z.string().optional(),
}).strict();

/** A slide's ingest output. `extractedText` is job-internal and never reaches a pack (spec §3). */
export const DeckSlideSchema = z.object({
  assetId: z.string().min(1),
  page: z.number().int().positive(),
  mediaKey: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fingerprint: z.string().min(1),
  extractedText: z.string(),
}).strict();

export const DeckSchema = z.object({
  jobId: z.string().min(1),
  packId: z.string().min(1),
  title: z.string().min(1),
  sourceKey: z.string().min(1),
  sourceFormat: z.enum(['pdf', 'pptx']),
  matching: z.object({
    algorithm: z.string().min(1),
    hashBits: z.number().int().positive(),
    maxHammingDistance: z.number().int().nonnegative(),
    minMargin: z.number().int().nonnegative(),
    onNoMatch: z.literal('source.unmatched'),
  }).strict(),
  slides: z.array(DeckSlideSchema).min(1),
}).strict();
export type Deck = z.infer<typeof DeckSchema>;

/** Deck Analyst output, spec §8 stage 2. */
export const LessonSchema = z.object({
  subject: z.string().min(1).max(80),
  level: z.string().min(1).max(60),
  summary: z.string().min(1).max(1500),
  concepts: z.array(z.object({
    name: z.string().min(1).max(120),
    slideRange: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  }).strict()).min(1).max(30),
}).strict();
export type Lesson = z.infer<typeof LessonSchema>;

/** Viz Planner output, spec §8 stage 5. `none` is the default on any failure. */
export const VizPlanSchema = z.object({
  decision: z.enum(['none', 'retrieve', 'adapt', 'generate']),
  concept: z.string().max(200).default(''),
  interaction: z.enum(['stepper', 'explorer', 'simulation', 'plot', 'hotspot', 'timeline', 'diagram']).optional(),
  rationale: z.string().max(800).default(''),
  parametersWanted: z.array(z.string().min(1)).max(10).default([]),
}).strict();
export type VizPlan = z.infer<typeof VizPlanSchema>;

/** Critic verdict, spec §8 stage 8. The harness half is deterministic; the critique is Sonnet. */
export const CritiqueSchema = z.object({
  verdict: z.enum(['pass', 'repair', 'reject']),
  fidelity: z.string().min(1).max(1200),
  problems: z.array(z.string().min(1).max(400)).max(10).default([]),
}).strict();

/** What the instructor decided about one slide, spec §7.1 `POST /v1/jobs/{id}/review`. */
export const ReviewDecisionSchema = z.object({
  assetId: z.string().min(1),
  regionEdits: z.array(z.object({
    regionId: z.string().min(1),
    shortDescription: z.string().min(1).max(700).optional(),
    plainLanguage: z.string().min(1).max(500).optional(),
  }).strict()).optional(),
  rejectRegions: z.array(z.string().min(1)).optional(),
  visualization: z.enum(['approve', 'reject', 'regenerate']).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
}).strict();
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

/**
 * The job record. `reviewedAssetIds` is the charter A3 gate in data form:
 * publish refuses to write any asset that is not listed here, so "an
 * instructor approved this" is a fact the publish stage can check rather than
 * a step someone remembered to take.
 */
export const JobRecordSchema = z.object({
  jobId: z.string().min(1),
  packId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().max(4000).optional(),
  profileId: z.string().min(1).optional(),
  status: JobStatusSchema,
  uploadId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.number().int().positive(),
  slides: z.array(SlideProgressSchema).default([]),
  visualHints: z.array(z.object({ slide: z.number().int().positive(), hint: z.string().min(1).max(500) }).strict()).default([]),
  reviewedAssetIds: z.array(z.string().min(1)).default([]),
  decisions: z.array(ReviewDecisionSchema).default([]),
  error: z.string().optional(),
  publishedVersion: z.number().int().positive().optional(),
}).strict();
export type JobRecord = z.infer<typeof JobRecordSchema>;
