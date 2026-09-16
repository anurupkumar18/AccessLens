import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { readFileSync } from 'node:fs';
import { SlideDraftSchema, type Lesson, type SlideDraft } from '../shared/jobs';
import { AgentStageError, runAgentStage, type AgentResult, type MessagesClient } from '../shared/agentStage';
import { verifyReferences, type Excerpt } from '../shared/references';
import type { AccessPack } from '../../apps/extension/src/shared/contracts';

/** Input required by the per-slide Pack Author stage (spec §8 stage 3). */
export interface PackAuthorInput {
  jobId: string;
  packId: string;
  assetId: string;
  /** One-based slide number, useful to the prompt and progress records. */
  slideNumber?: number;
  /** Staged PNG key. The stage never writes outside staging/{jobId}/. */
  mediaKey?: string;
  /** Optional existing fingerprint; ingest, not Sonnet, owns this field. */
  fingerprint?: string;
  /** Base64-encoded slide PNG. A Lambda handler can populate this from S3. */
  imageBase64: string;
  extractedText: string;
  lesson: Lesson;
  excerpts?: readonly Excerpt[];
}

export interface PackAuthorProgress {
  assetId: string;
  stage: 'describe';
  status: 'running' | 'ok' | 'needs_review';
  error?: string;
}

export interface PackAuthorAsset extends Omit<AccessPack['assets'][number], 'fingerprint'> {
  /** Ingest owns fingerprints; omitted while this stage is run standalone. */
  fingerprint?: string;
}

export interface PackAuthorResult {
  asset: PackAuthorAsset;
  status: 'ok' | 'needs_review';
  attempts: number;
  issues: string[][];
  error?: AgentStageError;
}

export interface PackAuthorOptions {
  agentClient?: MessagesClient;
  promptDirectory?: string;
  onProgress?: (progress: PackAuthorProgress) => void;
}

function formatExcerpt(excerpt: Excerpt, index: number): string {
  return [
    `Excerpt ${index + 1}:`,
    `docId: ${excerpt.docId}`,
    `title: ${excerpt.title}`,
    `page: ${excerpt.page}`,
    `text:`,
    excerpt.text,
  ].join('\n');
}

/**
 * Keep the prompt input deterministic and explicit. In particular, extracted
 * text is a separate user-turn section rather than something the model must
 * recover from an image, and every excerpt carries the identifiers required by
 * the reference verifier (spec §9.3–§9.5).
 */
export function packAuthorUserText(input: PackAuthorInput): string {
  const excerpts = (input.excerpts ?? []).slice(0, 4);
  return [
    `Describe slide ${input.assetId}${input.slideNumber ? ` (slide ${input.slideNumber})` : ''} from the deck "${input.lesson.subject}".`,
    '',
    'Deck context (lesson.json):',
    JSON.stringify(input.lesson, null, 2),
    '',
    'Deterministic text extracted from this slide by pdftotext -layout:',
    input.extractedText || '(No text was extracted from this slide.)',
    '',
    excerpts.length > 0
      ? ['Course-library excerpts (terminology and notation only; cite only these excerpts):', ...excerpts.map(formatExcerpt)].join('\n\n')
      : 'No course-library excerpts were supplied for this slide. Do not emit references.',
  ].join('\n');
}

function emptyAsset(input: PackAuthorInput): PackAuthorAsset {
  const asset: PackAuthorAsset = {
    assetId: input.assetId,
    ...(input.mediaKey ? { mediaUri: input.mediaKey } : {}),
    ...(input.fingerprint ? { fingerprint: input.fingerprint } : {}),
    title: input.assetId,
    readingOrder: [],
    regions: [],
  };
  return asset;
}

function toAsset(input: PackAuthorInput, draft: SlideDraft, excerpts: readonly Excerpt[]): PackAuthorAsset {
  const verified = verifyReferences(draft.references, excerpts).kept;
  const asset: PackAuthorAsset = {
    assetId: input.assetId,
    ...(input.mediaKey ? { mediaUri: input.mediaKey } : {}),
    ...(input.fingerprint ? { fingerprint: input.fingerprint } : {}),
    title: draft.title,
    readingOrder: draft.readingOrder,
    regions: draft.regions,
  };
  if (verified.length > 0) asset.references = verified;
  return asset;
}

/**
 * Run the Pack Author once. `runAgentStage` owns the forced tool call,
 * validation, and three-attempt repair loop; this function owns only the
 * stage-specific user turn, reference verification, and A3 failure behavior.
 */
export async function authorSlide(input: PackAuthorInput, options: PackAuthorOptions = {}): Promise<PackAuthorResult> {
  options.onProgress?.({ assetId: input.assetId, stage: 'describe', status: 'running' });
  const excerpts = (input.excerpts ?? []).slice(0, 4);
  try {
    const result: AgentResult<SlideDraft> = await runAgentStage({
      role: 'pack-author',
      toolName: 'submit_slide_description',
      toolDescription: 'Submit the draft accessibility description for one slide.',
      schema: SlideDraftSchema,
      userText: packAuthorUserText(input),
      images: [{ mediaType: 'image/png', base64: input.imageBase64 }],
      logId: input.assetId,
    }, options.agentClient, options.promptDirectory);
    const asset = toAsset(input, result.value, excerpts);
    options.onProgress?.({ assetId: input.assetId, stage: 'describe', status: 'ok' });
    return {
      asset,
      status: 'ok',
      attempts: result.attempts,
      issues: result.issues,
    };
  } catch (error) {
    // A failed slide is deliberately represented, not re-rolled with an
    // invented fallback. The review UI can show the slide and ask the
    // instructor to author it (charter A3 and spec §8 stage 3).
    if (!(error instanceof AgentStageError)) throw error;
    const asset = emptyAsset(input);
    options.onProgress?.({
      assetId: input.assetId,
      stage: 'describe',
      status: 'needs_review',
      error: error.message,
    });
    return {
      asset,
      status: 'needs_review',
      attempts: error.attempts,
      issues: error.issues,
      error,
    };
  }
}

export interface PackAuthorEvent extends Omit<PackAuthorInput, 'imageBase64'> {
  imageBase64?: string;
  /** Bucket can be supplied by the Step Functions event; env is the Lambda default. */
  bucket?: string;
  /** Override the default per-slide staging draft key in tests or a stack. */
  outputKey?: string;
}

interface S3Transport {
  send(command: unknown): Promise<unknown>;
}

export interface PackAuthorHandlerOptions extends PackAuthorOptions {
  s3Client?: S3Transport;
  /** Test-only S3 body seam. */
  readObject?: (key: string) => Promise<Uint8Array>;
  /** Test-only writer seam. */
  writeObject?: (key: string, body: Uint8Array | string, contentType: string) => Promise<void>;
}

function requiredBucket(event: PackAuthorEvent): string {
  const bucket = event.bucket ?? process.env.PACKS_BUCKET;
  if (!bucket) throw new Error('Missing required PACKS_BUCKET environment variable');
  return bucket;
}

async function bytesFromBody(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  if (body && typeof body === 'object' && 'transformToByteArray' in body) {
    const transform = (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray;
    return transform.call(body);
  }
  if (body && typeof body === 'object' && Symbol.asyncIterator in body) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
      chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
    }
    const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }
  throw new Error('S3 object response did not contain a readable body');
}

/** Lambda boundary for the per-slide stage. It writes only a job-scoped draft. */
export async function handlePackAuthor(event: PackAuthorEvent, options: PackAuthorHandlerOptions = {}): Promise<PackAuthorResult> {
  // The Lambda boundary is the only place a real client is created (same
  // rule as the analyst): tests inject readObject/writeObject and never touch S3.
  const s3 = options.s3Client ?? (!options.readObject || !options.writeObject ? new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' }) : undefined);
  const bucket = requiredBucket(event);
  const readObject = options.readObject ?? (async (key: string) => {
    if (!s3) throw new Error('s3Client is required when readObject is not supplied');
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key })) as { Body?: unknown };
    if (!response.Body) throw new Error(`S3 object ${key} had no body`);
    return bytesFromBody(response.Body);
  });
  const writeObject = options.writeObject ?? (async (key: string, body: Uint8Array | string, contentType: string) => {
    if (!s3) throw new Error('s3Client is required when writeObject is not supplied');
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  });
  const imageBase64 = event.imageBase64 ?? Buffer.from(await readObject(event.mediaKey ?? '')).toString('base64');
  const result = await authorSlide({ ...event, imageBase64 }, options);
  const outputKey = event.outputKey ?? `staging/${event.jobId}/draft/${event.assetId}.json`;
  // JSON is the job-internal seam consumed by Audio and Review. It is never a
  // published pack and intentionally retains the staging media URI.
  await writeObject(outputKey, JSON.stringify(result.asset) + '\n', 'application/json');
  return result;
}

export async function handler(event: PackAuthorEvent): Promise<PackAuthorResult> {
  return handlePackAuthor(event);
}

/** Useful to local callers that have a rendered PNG path rather than base64. */
export function imageFileAsBase64(path: string): string {
  return readFileSync(path).toString('base64');
}

export { SlideDraftSchema };
