/**
 * Lambda Function URL: instructor course media in, draft alt text and timed
 * words out.
 *
 * Two request kinds share one function because they share everything else --
 * the caller (the instructor's Prepare media panel), the posture (store
 * nothing, log no content), and the review gate the extension enforces on
 * whatever comes back.
 *
 *   { kind: 'alt-text', image: <base64>, mediaType: 'image/jpeg', context?: string }
 *     -> { draft: { decorative, altText, longDescription } }
 *   { kind: 'transcribe', audio: <base64 pcm16 16kHz mono>, lang?: 'en-US' }
 *     -> { words: [{ text, start, end }] }
 *
 * Nothing here throws out of the handler: an unhandled throw from a Function URL
 * is an AWS error body the extension cannot parse.
 */
import type { ImageFormat } from '@aws-sdk/client-bedrock-runtime';
import { parseDraft, type AltTextDraft } from './altText.js';
import { requestAltText, SAMPLE_RATE_HZ, transcribeWithTimings } from './aws.js';
import { toTimedWords, type TimedWord } from './words.js';

/** Bedrock's per-image limit. The extension downscales well below it. */
export const MAX_IMAGE_BYTES = Math.floor(3.75 * 1024 * 1024);
/** ~164 s of pcm16 16 kHz mono; the extension sends about a minute at a time. */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

const FORMATS: Record<string, ImageFormat> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

interface FunctionUrlEvent {
  requestContext?: { http?: { method?: string } } | undefined;
  body?: string | null | undefined;
  isBase64Encoded?: boolean | undefined;
}

interface FunctionUrlResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface AltTextResponse { draft: AltTextDraft }
export interface TranscribeResponse { words: TimedWord[] }

/** CORS is owned by the Function URL; a second header set breaks every browser call. */
const json = (statusCode: number, payload: unknown): FunctionUrlResult => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});

const fail = (statusCode: number, error: string) => json(statusCode, { error });

/** Content is never logged; the shape of the call is. */
function logLine(event: string, fields: Record<string, string | number>): void {
  console.log(JSON.stringify({ event, ...fields }));
}

function decode(base64: string, maxBytes: number): Uint8Array | 'too-large' | undefined {
  if (base64.length > Math.ceil((maxBytes * 4) / 3) + 1024) return 'too-large';
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
  if (bytes.byteLength === 0) return undefined;
  return bytes.byteLength > maxBytes ? 'too-large' : bytes;
}

async function altText(body: Record<string, unknown>): Promise<FunctionUrlResult> {
  const format = FORMATS[String(body['mediaType'])];
  if (!format) return fail(400, 'Images must be JPEG, PNG, GIF, or WebP.');
  const image = decode(typeof body['image'] === 'string' ? body['image'] : '', MAX_IMAGE_BYTES);
  if (image === 'too-large') return fail(400, 'This image is too large to describe. Try a smaller version.');
  if (!image) return fail(400, 'image is required and must be base64-encoded.');
  const context = typeof body['context'] === 'string' ? body['context'] : '';

  try {
    const draft = parseDraft(await requestAltText(image, format, context));
    if (!draft) {
      logLine('alt-text-unusable', { imageBytes: image.byteLength });
      return fail(502, 'The model did not return usable alt text. Write this one by hand or try again.');
    }
    logLine('alt-text-drafted', { imageBytes: image.byteLength, contextChars: context.length });
    const response: AltTextResponse = { draft };
    return json(200, response);
  } catch (error) {
    logLine('alt-text-failed', { reason: error instanceof Error ? error.name : 'unknown' });
    return fail(502, 'The alt text service could not reach the model.');
  }
}

async function transcribe(body: Record<string, unknown>): Promise<FunctionUrlResult> {
  const audio = decode(typeof body['audio'] === 'string' ? body['audio'] : '', MAX_AUDIO_BYTES);
  if (audio === 'too-large') return fail(400, 'Audio chunk is too large. Send about a minute at a time.');
  if (!audio) return fail(400, 'audio is required and must be base64-encoded pcm16 audio.');
  const lang = typeof body['lang'] === 'string' && body['lang'].trim().length >= 2 ? body['lang'].trim() : 'en-US';

  try {
    const words = toTimedWords(await transcribeWithTimings(audio, lang));
    logLine('transcribed', { seconds: audio.byteLength / 2 / SAMPLE_RATE_HZ, words: words.length, lang });
    const response: TranscribeResponse = { words };
    return json(200, response);
  } catch (error) {
    logLine('transcribe-failed', { reason: error instanceof Error ? error.name : 'unknown' });
    return fail(502, 'Transcription is unavailable right now. Try again.');
  }
}

export const handler = async (event: FunctionUrlEvent): Promise<FunctionUrlResult> => {
  try {
    const method = (event.requestContext?.http?.method ?? 'POST').toUpperCase();
    if (method === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
    if (method !== 'POST') return fail(405, 'This endpoint accepts POST.');

    const raw = event.isBase64Encoded && event.body ? Buffer.from(event.body, 'base64').toString('utf8') : event.body ?? '';
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
      body = parsed as Record<string, unknown>;
    } catch {
      return fail(400, 'Request body must be a JSON object.');
    }

    if (body['kind'] === 'alt-text') return await altText(body);
    if (body['kind'] === 'transcribe') return await transcribe(body);
    return fail(400, "kind must be 'alt-text' or 'transcribe'.");
  } catch (error) {
    logLine('media-access-unhandled', { reason: error instanceof Error ? error.name : 'unknown' });
    return fail(502, 'The media accessibility service is temporarily unavailable.');
  }
};
