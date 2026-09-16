import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import {
  AccessPackSchema,
  ArtifactManifestSchema,
  type AccessPack,
} from '../../apps/extension/src/shared/contracts';
import {
  DeckSchema,
  JobRecordSchema,
  type Deck,
  type JobRecord,
  type ReviewDecision,
} from '../shared/jobs';
import {
  JobDraftResponseSchema,
  PublishResponseSchema,
  ReviewRequestSchema,
  ReviewResponseSchema,
} from '../shared/api';
import {
  publishPack,
  type ObjectStore,
  type PublishResult,
  type StagedAsset,
} from './index';

const JobIdInputSchema = z.object({ jobId: z.string().min(1) }).strict();
const ReviewRouteInputSchema = z.object({
  jobId: z.string().min(1),
  decisions: ReviewRequestSchema.shape.decisions,
}).strict();

const BoundsSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
}).strict();
const StagedRegionSchema = z.object({
  regionId: z.string(),
  label: z.string().min(1).optional(),
  bounds: BoundsSchema,
  shortDescription: z.string(),
  plainLanguage: z.string(),
  audioUri: z.string().min(1).optional(),
}).strict();
const StagedAssetSchema = z.object({
  assetId: z.string().min(1),
  mediaUri: z.string().min(1).optional(),
  fingerprint: z.string().min(1).optional(),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  readingOrder: z.array(z.string()),
  regions: z.array(StagedRegionSchema),
  visualization: z.object({
    artifactId: z.string().min(1),
    artifactVersion: z.number().int().positive(),
    parameters: z.record(z.string(), z.unknown()).default({}),
    notes: z.string().max(1000).optional(),
    regionMap: z.record(z.string(), z.string()).optional(),
  }).strict().optional(),
  references: z.array(z.object({
    docId: z.string().min(1),
    title: z.string().min(1),
    page: z.number().int().positive(),
    quote: z.string().min(1).max(300),
  }).strict()).optional(),
}).strict();

const DraftVisualizationSchema = z.object({
  assetId: z.string().min(1),
  artifact: ArtifactManifestSchema,
  screenshotUrl: z.string().min(1),
  critique: z.string(),
}).strict();

type DynamoTransport = { send(command: unknown): Promise<unknown> };

/**
 * API dependencies are deliberately injected. The API lane can adapt its
 * DynamoDB/S3/Step Functions clients without moving business rules into a
 * handler, and route tests can run without AWS credentials.
 */
export interface PublishRouteDeps {
  dynamodb: DynamoTransport;
  s3: ObjectStore;
  jobsTableName: string;
  packsBucket?: string;
  publicBaseUrl?: string;
  now?: () => string;
  /**
   * Production may provide an adapter that starts/awaits the Standard
   * execution through the Step Functions client. Tests and local callers can
   * inject this deterministic stage directly. The route still owns the job
   * status and response validation around the adapter.
   */
  publish?: (input: { job: JobRecord; jobId: string }) => Promise<PublishResponse>;
  startPublish?: (input: { job: JobRecord; jobId: string }) => Promise<PublishResponse>;
  stepFunctions?: unknown;
}

export interface PublishResponse {
  packId: string;
  version: number;
  packUrl: string;
}

export class PublishRouteError extends Error {
  readonly statusCode: 400 | 404 | 409 | 500;
  readonly code: string;

  constructor(message: string, statusCode: PublishRouteError['statusCode'] = 400, code = 'authoring_route_error') {
    super(message);
    this.name = 'PublishRouteError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

async function loadJob(input: { jobId: string }, deps: PublishRouteDeps): Promise<JobRecord> {
  const response = await deps.dynamodb.send(new GetCommand({
    TableName: deps.jobsTableName,
    Key: { jobId: input.jobId },
  })) as { Item?: unknown };
  if (!response.Item) throw new PublishRouteError(`job ${input.jobId} was not found`, 404, 'job_not_found');
  try {
    return JobRecordSchema.parse(response.Item);
  } catch (error) {
    throw new PublishRouteError(`job ${input.jobId} has an invalid record`, 500, 'invalid_job_record');
  }
}

async function readJson(store: ObjectStore, key: string): Promise<unknown> {
  try {
    const bytes = await store.read(key);
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new PublishRouteError(`staged object ${key} is not valid JSON`, 500, 'invalid_staged_json');
    throw new PublishRouteError(`staged object ${key} could not be read`, 500, 'missing_staged_object');
  }
}

function draftPack(job: JobRecord, deck: Deck, assets: readonly StagedAsset[]): AccessPack {
  const assetsById = new Map(assets.map(asset => [asset.assetId, asset]));
  const deckIds = new Set(deck.slides.map(slide => slide.assetId));
  if (assetsById.size !== deck.slides.length || deck.slides.some(slide => !assetsById.has(slide.assetId))) {
    throw new PublishRouteError('staged draft does not contain one asset for every deck slide', 500, 'incomplete_staged_draft');
  }
  for (const asset of assets) {
    if (!deckIds.has(asset.assetId)) throw new PublishRouteError(`staged draft contains unknown asset ${asset.assetId}`, 500, 'unknown_staged_asset');
  }
  const candidate = {
    schemaVersion: '1.0' as const,
    packId: job.packId,
    // AccessPackSchema models a pack version as positive even while it is a
    // draft. Publish replaces this with max(existing)+1 and never exposes this
    // draft version to students.
    version: 1,
    title: job.title,
    matching: deck.matching,
    assets: deck.slides.map(slide => {
      const staged = assetsById.get(slide.assetId)!;
      return {
        ...staged,
        assetId: slide.assetId,
        fingerprint: slide.fingerprint,
      };
    }),
  };
  try {
    return AccessPackSchema.parse(candidate);
  } catch (error) {
    throw new PublishRouteError('staged draft fails AccessPackSchema validation', 500, 'invalid_staged_pack');
  }
}

async function stagedDraft(job: JobRecord, deps: PublishRouteDeps): Promise<{ deck: Deck; assets: StagedAsset[]; pack: AccessPack }> {
  const deck = DeckSchema.parse(await readJson(deps.s3, `staging/${job.jobId}/deck.json`));
  const assets: StagedAsset[] = [];
  for (const slide of deck.slides) {
    const raw = await readJson(deps.s3, `staging/${job.jobId}/draft/${slide.assetId}.json`);
    try {
      assets.push(StagedAssetSchema.parse(raw) as StagedAsset);
    } catch (error) {
      throw new PublishRouteError(`staged asset ${slide.assetId} fails draft validation`, 500, 'invalid_staged_asset');
    }
  }
  return { deck, assets, pack: draftPack(job, deck, assets) };
}

async function stagedVisualizations(job: JobRecord, deps: PublishRouteDeps): Promise<Array<z.infer<typeof DraftVisualizationSchema>>> {
  const key = `staging/${job.jobId}/visualizations.json`;
  try {
    const value = await readJson(deps.s3, key);
    return z.array(DraftVisualizationSchema).parse(value);
  } catch (error) {
    // Visualization stages are an extension point in V4. An absent metadata
    // file means there are no candidate visualizations, not a failed pack.
    if (error instanceof PublishRouteError && error.code === 'missing_staged_object') return [];
    throw error;
  }
}

/** GET /v1/jobs/{jobId}/draft route logic (spec §7.1, §8 stage 9). */
export async function getJobDraft(input: unknown, deps: PublishRouteDeps): Promise<z.infer<typeof JobDraftResponseSchema>> {
  const parsedInput = JobIdInputSchema.parse(input);
  const job = await loadJob(parsedInput, deps);
  if (job.status !== 'review') {
    throw new PublishRouteError(`job ${job.jobId} is not ready for review (status ${job.status})`, 409, 'job_not_in_review');
  }
  const { pack } = await stagedDraft(job, deps);
  const visualizations = await stagedVisualizations(job, deps);
  return JobDraftResponseSchema.parse({
    jobId: job.jobId,
    status: job.status,
    pack,
    visualizations,
  });
}

/** POST /v1/jobs/{jobId}/review route logic. */
export async function reviewJob(input: unknown, deps: PublishRouteDeps): Promise<z.infer<typeof ReviewResponseSchema>> {
  const parsedInput = ReviewRouteInputSchema.parse(input);
  const job = await loadJob(parsedInput, deps);
  if (job.status !== 'review') {
    throw new PublishRouteError(`job ${job.jobId} is not accepting review decisions (status ${job.status})`, 409, 'job_not_in_review');
  }
  const decisions: ReviewDecision[] = ReviewRequestSchema.parse({ decisions: parsedInput.decisions }).decisions;
  const knownAssetIds = new Set(job.slides.map(slide => slide.assetId));
  for (const decision of decisions) {
    if (!knownAssetIds.has(decision.assetId)) {
      throw new PublishRouteError(`review decision names unknown asset ${decision.assetId}`, 400, 'unknown_asset');
    }
  }
  const reviewedAssetIds = [...new Set([...job.reviewedAssetIds, ...decisions.map(decision => decision.assetId)])];
  const allDecisions = [...job.decisions, ...decisions];
  const updatedAt = deps.now?.() ?? new Date().toISOString();
  await deps.dynamodb.send(new UpdateCommand({
    TableName: deps.jobsTableName,
    Key: { jobId: job.jobId },
    UpdateExpression: 'SET #decisions = :decisions, #reviewedAssetIds = :reviewedAssetIds, #updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#decisions': 'decisions',
      '#reviewedAssetIds': 'reviewedAssetIds',
      '#updatedAt': 'updatedAt',
    },
    ExpressionAttributeValues: {
      ':decisions': allDecisions,
      ':reviewedAssetIds': reviewedAssetIds,
      ':updatedAt': updatedAt,
    },
    ReturnValues: 'NONE',
  }));
  return ReviewResponseSchema.parse({
    jobId: job.jobId,
    status: job.status,
    reviewedAssetIds,
  });
}

/**
 * POST /v1/jobs/{jobId}/publish route logic. The stack can inject a
 * Step-Functions adapter (`startPublish`) that waits for the Standard
 * execution and returns its result. For local/fake use, `publish` can invoke
 * the deterministic stage directly; the fallback below keeps the route useful
 * without an adapter and still never bypasses publishPack's A3 gate.
 */
export async function publishJob(input: unknown, deps: PublishRouteDeps): Promise<PublishResponse> {
  const parsedInput = JobIdInputSchema.parse(input);
  const job = await loadJob(parsedInput, deps);
  if (job.status !== 'review') {
    throw new PublishRouteError(`job ${job.jobId} is not ready to publish (status ${job.status})`, 409, 'job_not_in_review');
  }
  const updatedAt = deps.now?.() ?? new Date().toISOString();
  await deps.dynamodb.send(new UpdateCommand({
    TableName: deps.jobsTableName,
    Key: { jobId: job.jobId },
    UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt',
    ExpressionAttributeNames: { '#status': 'status', '#updatedAt': 'updatedAt' },
    ExpressionAttributeValues: { ':status': 'publishing', ':updatedAt': updatedAt },
    ReturnValues: 'NONE',
  }));

  try {
    const adapter = deps.startPublish ?? deps.publish;
    let response: PublishResponse;
    if (adapter) {
      response = PublishResponseSchema.parse(await adapter({ job, jobId: job.jobId }));
    } else {
      const staged = await stagedDraft(job, deps);
      const result: PublishResult = await publishPack({
        job: { ...job, status: 'publishing' },
        deck: staged.deck,
        assets: staged.assets,
        publicBaseUrl: deps.publicBaseUrl,
        publishedAt: deps.now?.() ?? new Date().toISOString(),
      }, deps.s3);
      response = PublishResponseSchema.parse({ packId: result.packId, version: result.version, packUrl: result.packUrl });
    }
    const publishedAt = deps.now?.() ?? new Date().toISOString();
    await deps.dynamodb.send(new UpdateCommand({
      TableName: deps.jobsTableName,
      Key: { jobId: job.jobId },
      UpdateExpression: 'SET #status = :status, #publishedVersion = :publishedVersion, #updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#status': 'status', '#publishedVersion': 'publishedVersion', '#updatedAt': 'updatedAt' },
      ExpressionAttributeValues: { ':status': 'published', ':publishedVersion': response.version, ':updatedAt': publishedAt },
      ReturnValues: 'NONE',
    }));
    return PublishResponseSchema.parse(response);
  } catch (error) {
    // Keep a failed publish retryable from the review queue. In particular, a
    // schema or approval failure must not turn a correctable draft into a
    // permanently terminal job.
    await deps.dynamodb.send(new UpdateCommand({
      TableName: deps.jobsTableName,
      Key: { jobId: job.jobId },
      UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt, #error = :error',
      ExpressionAttributeNames: { '#status': 'status', '#updatedAt': 'updatedAt', '#error': 'error' },
      ExpressionAttributeValues: {
        ':status': 'review',
        ':updatedAt': deps.now?.() ?? new Date().toISOString(),
        ':error': error instanceof Error ? error.message : String(error),
      },
      ReturnValues: 'NONE',
    }));
    throw error;
  }
}

export { JobDraftResponseSchema, PublishResponseSchema, ReviewRequestSchema, ReviewResponseSchema };
