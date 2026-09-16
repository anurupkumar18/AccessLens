import { PutObjectCommand } from '@aws-sdk/client-s3';
import { LessonSchema, type Lesson } from '../shared/jobs';
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
    const filteredReferences = verifyReferences(result.value.references, excerpts).kept;
    const lesson = filteredReferences.length > 0
      ? { ...result.value, references: filteredReferences }
      : { ...result.value, references: [] };
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

export interface AnalystEvent extends Omit<DeckAnalystInput, 'slides'> {
  slides: readonly AnalystSlideInput[];
  bucket?: string;
  outputKey?: string;
}

interface S3Transport { send(command: unknown): Promise<unknown> }

export interface AnalystHandlerOptions extends DeckAnalystOptions {
  s3Client?: S3Transport;
  writeObject?: (key: string, body: string, contentType: string) => Promise<void>;
}

/** Lambda boundary. The lesson is an internal job artifact under staging. */
export async function handleDeckAnalyst(event: AnalystEvent, options: AnalystHandlerOptions = {}): Promise<DeckAnalystResult> {
  const result = await runDeckAnalyst(event, options);
  if (!result.lesson) return result;
  const bucket = event.bucket ?? process.env.PACKS_BUCKET;
  const outputKey = event.outputKey ?? `staging/${event.jobId}/lesson.json`;
  const writeObject = options.writeObject ?? (async (key: string, body: string, contentType: string) => {
    if (!options.s3Client) throw new Error('s3Client is required when writeObject is not supplied');
    await options.s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  });
  if (!bucket && !options.writeObject) throw new Error('Missing required PACKS_BUCKET environment variable');
  await writeObject(outputKey, JSON.stringify(result.lesson) + '\n', 'application/json');
  return result;
}

export async function handler(event: AnalystEvent): Promise<DeckAnalystResult> {
  return handleDeckAnalyst(event);
}
