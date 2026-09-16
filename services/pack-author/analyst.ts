import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DeckSchema, LessonSchema, type Deck, type Lesson } from '../shared/jobs';
import { AgentStageError, runAgentStage, type AgentResult, type MessagesClient } from '../shared/agentStage';
import { verifyReferences, type Excerpt } from '../shared/references';

export interface AnalystSlideInput {
  assetId: string;
  page: number;
  extractedText: string;
  /** Base64 PNG; only the first three are sent to the analyst. */
  imageBase64?: string;
}

export interface DeckAnalystInput {
  jobId: string;
  packId: string;
  title: string;
  description?: string;
  slideCount: number;
  /** All extracted deck text, kept deterministic and separate from images. */
  extractedText: string;
  slides: readonly AnalystSlideInput[];
  excerpts?: readonly Excerpt[];
}

/**
 * The Step Functions input retains the ingested Deck under `deck`; its slide
 * PNGs remain in S3 staging rather than being copied through every state. The
 * handler accepts that execution shape and hydrates the analyst's first-three
 * image inputs at the Lambda boundary.
 */
export interface AnalystEvent {
  jobId: string;
  packId: string;
  title: string;
  description?: string;
  deck?: Deck;
  slideCount?: number;
  extractedText?: string;
  slides?: readonly AnalystSlideInput[];
  excerpts?: readonly Excerpt[];
  bucket?: string;
  outputKey?: string;
}

export interface AnalystProgress {
  stage: 'analyst';
  status: 'running' | 'ok' | 'needs_input';
  error?: string;
}

export interface DeckAnalystResult {
  lesson?: Lesson;
  status: 'ok' | 'needs_input';
  attempts: number;
  issues: string[][];
  error?: AgentStageError;
}

export interface DeckAnalystOptions {
  agentClient?: MessagesClient;
  promptDirectory?: string;
  onProgress?: (progress: AnalystProgress) => void;
}

/** The prompt receives no more than the retrieval contract's eight excerpts. */
export function analystUserText(input: DeckAnalystInput): string {
  const excerpts = (input.excerpts ?? []).slice(0, 8);
  const excerptText = excerpts.length > 0
    ? ['Course-library excerpts (use only to name concepts and cite verbatim):', ...excerpts.map((excerpt, index) => [
      `Excerpt ${index + 1}:`,
      `docId: ${excerpt.docId}`,
      `title: ${excerpt.title}`,
      `page: ${excerpt.page}`,
      'text:',
      excerpt.text,
    ].join('\n'))].join('\n\n')
    : 'No course-library excerpts were supplied. Do not emit references.';
  return [
    `Analyze the lecture deck "${input.title}".`,
    '',
    `Instructor description: ${input.description || '(none supplied)'}`,
    `Slide count: ${input.slideCount}`,
    '',
    'Deterministic extracted text from every slide:',
    input.extractedText || '(No text was extracted from the deck.)',
    '',
    excerptText,
  ].join('\n');
}

function lessonSchemaForSlideCount(slideCount: number) {
  return LessonSchema.superRefine((lesson, ctx) => {
    for (const [index, concept] of lesson.concepts.entries()) {
      const [firstSlide, lastSlide] = concept.slideRange;
      if (firstSlide > lastSlide) {
        ctx.addIssue({ code: 'custom', path: ['concepts', index, 'slideRange'], message: 'slideRange must be ordered from firstSlide to lastSlide' });
      }
      if (lastSlide > slideCount) {
        ctx.addIssue({ code: 'custom', path: ['concepts', index, 'slideRange'], message: `slideRange must remain between slide 1 and slide ${slideCount}` });
      }
    }
  });
}

/**
 * Run the deck-level analyst. AgentStage owns forced tools and repair attempts;
 * this wrapper adds the deck-specific range constraint and citation filtering.
 */
export async function runDeckAnalyst(input: DeckAnalystInput, options: DeckAnalystOptions = {}): Promise<DeckAnalystResult> {
  if (!Number.isInteger(input.slideCount) || input.slideCount < 1) throw new Error('slideCount must be a positive integer');
  options.onProgress?.({ stage: 'analyst', status: 'running' });
  const suppliedSlides = input.slides.slice(0, 3);
  const images = suppliedSlides
    .filter(slide => Boolean(slide.imageBase64))
    .map(slide => ({ mediaType: 'image/png' as const, base64: slide.imageBase64! }));
  const excerpts = (input.excerpts ?? []).slice(0, 8);
  try {
    const result: AgentResult<Lesson> = await runAgentStage({
      role: 'deck-analyst',
      toolName: 'submit_lesson',
      toolDescription: 'Submit the compact lesson context for this lecture deck.',
      schema: lessonSchemaForSlideCount(input.slideCount),
      userText: analystUserText(input),
      images,
      logId: input.jobId,
    }, options.agentClient, options.promptDirectory);
    const filteredReferences = verifyReferences(result.value.references, excerpts).kept.map(reference => ({
      docId: reference.docId,
      page: reference.page,
      quote: reference.quote,
    }));
    // `LessonSchema.references` is the claimed-reference shape at the agent
    // boundary. The excerpt title is deliberately not copied into lesson.json;
    // only the pack-facing verified reference shape carries it after a stage
    // that owns an AccessPack asset.
    const lesson = LessonSchema.parse({ ...result.value, references: filteredReferences });
    options.onProgress?.({ stage: 'analyst', status: 'ok' });
    return { lesson, status: 'ok', attempts: result.attempts, issues: result.issues };
  } catch (error) {
    if (!(error instanceof AgentStageError)) throw error;
    options.onProgress?.({ stage: 'analyst', status: 'needs_input', error: error.message });
    return {
      status: 'needs_input', attempts: error.attempts, issues: error.issues, error,
    };
  }
}

interface S3Transport { send(command: unknown): Promise<unknown> }

export interface AnalystHandlerOptions extends DeckAnalystOptions {
  s3Client?: S3Transport;
  readObject?: (key: string) => Promise<Uint8Array>;
  writeObject?: (key: string, body: string, contentType: string) => Promise<void>;
}

function ensureStagedOutputKey(key: string, jobId: string): void {
  const prefix = `staging/${jobId}/`;
  if (!key.startsWith(prefix) || key.includes('..')) {
    throw new Error(`analyst output must be under ${prefix}; received ${key}`);
  }
}

async function bodyBytes(body: unknown): Promise<Uint8Array> {
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
    const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }
  throw new Error('S3 object response did not contain a readable body');
}

function deckAnalystInput(event: AnalystEvent, slides: readonly AnalystSlideInput[]): DeckAnalystInput {
  const deck = event.deck;
  const resolvedSlides = slides.length > 0
    ? slides
    : deck?.slides.map(slide => ({
      assetId: slide.assetId,
      page: slide.page,
      extractedText: slide.extractedText,
    })) ?? [];
  const extractedText = event.extractedText ?? (deck?.slides ?? resolvedSlides).map(slide => `${'assetId' in slide ? slide.assetId : ''}\n${slide.extractedText}`).join('\n\n');
  return {
    jobId: event.jobId,
    packId: event.packId,
    title: event.title,
    ...(event.description === undefined ? {} : { description: event.description }),
    slideCount: event.slideCount ?? deck?.slides.length ?? resolvedSlides.length,
    extractedText,
    slides: resolvedSlides,
    excerpts: event.excerpts,
  };
}

/** Lambda boundary. The lesson is an internal job artifact under staging. */
export async function handleDeckAnalyst(event: AnalystEvent, options: AnalystHandlerOptions = {}): Promise<DeckAnalystResult> {
  const bucket = event.bucket ?? process.env.PACKS_BUCKET;
  const defaultS3 = options.s3Client ?? (!options.readObject || !options.writeObject ? new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' }) : undefined);
  const readObject = options.readObject ?? (async (key: string) => {
    if (!defaultS3 || !bucket) throw new Error('S3 and PACKS_BUCKET are required to hydrate analyst slide images');
    const response = await defaultS3.send(new GetObjectCommand({ Bucket: bucket, Key: key })) as { Body?: unknown };
    if (!response.Body) throw new Error(`S3 object ${key} had no body`);
    return bodyBytes(response.Body);
  });
  const sourceSlides: AnalystSlideInput[] = (event.slides ?? event.deck?.slides.map(slide => ({
    assetId: slide.assetId,
    page: slide.page,
    extractedText: slide.extractedText,
  })) ?? []).map(slide => ({ ...slide }));
  const hydratedSlides = await Promise.all(sourceSlides.map(async (slide, index): Promise<AnalystSlideInput> => {
    if (index >= 3 || slide.imageBase64) return slide;
    const sourceKey = event.deck?.slides.find(candidate => candidate.assetId === slide.assetId)?.mediaKey;
    if (!sourceKey) return slide;
    return { ...slide, imageBase64: Buffer.from(await readObject(sourceKey)).toString('base64') };
  }));
  const result = await runDeckAnalyst(deckAnalystInput(event, hydratedSlides), options);
  if (!result.lesson) return result;
  const outputKey = event.outputKey ?? `staging/${event.jobId}/lesson.json`;
  ensureStagedOutputKey(outputKey, event.jobId);
  const writeObject = options.writeObject ?? (async (key: string, body: string, contentType: string) => {
    if (!defaultS3 || !bucket) throw new Error('S3 and PACKS_BUCKET are required to write analyst output');
    await defaultS3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  });
  await writeObject(outputKey, JSON.stringify(result.lesson) + '\n', 'application/json');
  return result;
}

export async function handler(event: AnalystEvent): Promise<DeckAnalystResult> {
  return handleDeckAnalyst(event);
}
