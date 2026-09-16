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
import { ClaimedReferencesField } from './references';

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

// Spec §9.4: every agent output schema that can carry references gains an
// optional `references[]`. They are *claimed* here -- the stage runs each one
// through verifyReferences against the excerpts that call was actually given,
// and drops what it cannot confirm, before anything reaches a pack.
/** Deck Analyst output, spec §8 stage 2. */
export const LessonSchema = z.object({
  subject: z.string().min(1).max(80),
  level: z.string().min(1).max(60),
  summary: z.string().min(1).max(1500),
  concepts: z.array(z.object({
    name: z.string().min(1).max(120),
    slideRange: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  }).strict()).min(1).max(30),
  references: ClaimedReferencesField,
}).strict();
export type Lesson = z.infer<typeof LessonSchema>;

/**
 * Pack Author output, spec §8 stage 3. Ported from the `Draft` schema in
 * `scripts/build-pack.ts` -- the caps and the unique-regionId refinement are
 * the prototype's, unchanged, because the prompt's rules and this schema are
 * two halves of the same contract and loosening either one is how a confident
 * wrong description reaches a student.
 */
export const SHORT_DESCRIPTION_WORD_CAP = 60;
export const PLAIN_LANGUAGE_WORD_CAP = 35;

const wordCount = (text: string) => text.trim().split(/\s+/u).filter(Boolean).length;

/**
 * The prompt states the caps in words -- "at most 60 words, a screen reader
 * can speak" -- so the schema has to state them in words too. The prototype's
 * character caps do not: 700 characters is comfortably 100 words, which is
 * what an evaluation run against real slides produced, and nothing caught it
 * because nothing was checking the rule the prompt actually gives. Enforcing
 * it here means the repair loop fixes an overrun on the next attempt instead
 * of a reviewer finding it, or not finding it.
 */
const wordCapped = (cap: number, charCap: number, field: string, purpose: string) =>
  z.string().min(1).max(charCap)
    // The description reaches the model: z.toJSONSchema renders it into the
    // tool's input_schema. That matters more than it looks. The first
    // evaluation run against real slides produced descriptions of up to 100
    // words, because the schema advertised maxLength 700 and said nothing
    // about words -- so the model optimised to the limit it was actually
    // shown. The character cap below is now the same rule in the same units.
    .describe(`${purpose} At most ${cap} words.`)
    .superRefine((text, ctx) => {
      const n = wordCount(text);
      // The count goes in the message because the message is what the repair
      // turn shows the model, and "shorten this" is a worse instruction than
      // "this is 100 words and the cap is 60".
      if (n > cap) ctx.addIssue({ code: 'custom', message: `${field} is ${n} words; the cap is ${cap}. Rewrite it shorter.` });
    });

export const SlideDraftSchema = z.object({
  title: z.string().min(1).max(120),
  readingOrder: z.array(z.string().min(1)).min(1),
  regions: z.array(z.object({
    regionId: z.string().regex(/^[a-z0-9-]+$/),
    bounds: z.object({
      x: z.number().min(0).max(1), y: z.number().min(0).max(1),
      width: z.number().min(0).max(1), height: z.number().min(0).max(1),
    }),
    shortDescription: wordCapped(SHORT_DESCRIPTION_WORD_CAP, 460, 'shortDescription',
      'One or two factual sentences a screen reader can speak, describing what is shown.'),
    plainLanguage: wordCapped(PLAIN_LANGUAGE_WORD_CAP, 280, 'plainLanguage',
      'One shorter sentence with the same meaning in simpler words.'),
  })).min(1).max(6).refine(rs => new Set(rs.map(r => r.regionId)).size === rs.length, {
    message: 'regionIds must be unique within a slide',
  }),
  references: ClaimedReferencesField,
}).strict();
export type SlideDraft = z.infer<typeof SlideDraftSchema>;

/** Viz Planner output, spec §8 stage 5. `none` is the default on any failure. */
export const VizPlanSchema = z.object({
  decision: z.enum(['none', 'retrieve', 'adapt', 'generate']),
  concept: z.string().max(200).default(''),
  interaction: z.enum(['stepper', 'explorer', 'simulation', 'plot', 'hotspot', 'timeline', 'diagram']).optional(),
  rationale: z.string().max(800).default(''),
  parametersWanted: z.array(z.string().min(1)).max(10).default([]),
  references: ClaimedReferencesField,
}).strict();
export type VizPlan = z.infer<typeof VizPlanSchema>;

/** Critic verdict, spec §8 stage 8. The harness half is deterministic; the critique is Sonnet. */
export const CritiqueSchema = z.object({
  verdict: z.enum(['pass', 'repair', 'reject']),
  fidelity: z.string().min(1).max(1200),
  problems: z.array(z.string().min(1).max(400)).max(10).default([]),
  references: ClaimedReferencesField,
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
  /** Google subject id of the instructor who created the job; every job route is scoped to it (D12). */
  ownerSub: z.string().min(1).optional(),
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
