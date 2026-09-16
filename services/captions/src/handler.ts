/**
 * Lambda Function URL: instructor audio in, caption events out.
 *
 * The caller is a browser extension running on whatever page the instructor has
 * open, so this is a public, CORS-wide-open POST endpoint that must never
 * depend on an origin it cannot predict. It is also the one request in the
 * system where failing loudly is worse than failing quietly: a student watching
 * captions would rather see the stream pause than see a stack trace, so every
 * path below returns a response and nothing here throws.
 *
 * Division of labour: this file validates and adapts, `transcribe.ts` talks to
 * AWS, `captions.ts` decides what a caption is. Nothing that can be decided
 * without a credential is decided here.
 */
import { toCaptionEvents, type Caption, type CaptionAppendedEvent } from './captions.js';
import { log, logEvent } from './log.js';
import { DEFAULT_LANGUAGE, SAMPLE_RATE_HZ, transcribeChunk } from './transcribe.js';

/**
 * ~5MB of pcm16/16kHz/mono is about 164 seconds of speech. Past that the caller
 * is batching, not captioning, and the request would blow the Lambda's own
 * payload limit anyway -- better a clear 400 than a truncated body that decodes
 * into noise and transcribes into nonsense a student then reads.
 */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

/** Base64 costs 4 characters per 3 bytes; +1KB of slack for padding and whitespace. */
const MAX_AUDIO_BASE64_CHARS = Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 1024;

/**
 * CORS is owned by the Function URL, not by this handler.
 *
 * Both used to set it, and a response carrying two `Access-Control-Allow-Origin`
 * headers is rejected outright by browsers -- the request fails CORS and `fetch`
 * throws, which reaches a student as "could not reach the service". It was
 * invisible to every curl test, because curl does not enforce CORS at all.
 *
 * The Function URL answers the preflight itself, so OPTIONS never reaches this
 * code. The constant stays so response shapes are unchanged; it is just empty.
 */
const CORS_HEADERS: Record<string, string> = {};

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

export interface CaptionsResponse {
  captions: Caption[];
}

function json(statusCode: number, payload: unknown): FunctionUrlResult {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function fail(statusCode: number, error: string, message: string): FunctionUrlResult {
  return json(statusCode, { error, message });
}

/**
 * The pack the caption stream belongs to.
 *
 * A `caption.appended` event has to name a pack and version -- students bind the
 * stream to the pack their renderer loaded -- but the extension posts only a
 * session and audio. Configuration supplies the rest, defaulting to the pack the
 * demo session actually runs.
 */
function packIdentity(): { packId: string; packVersion: number } {
  const packId = process.env['CAPTIONS_PACK_ID'] || 'bio-cell-demo';
  const parsed = Number.parseInt(process.env['CAPTIONS_PACK_VERSION'] ?? '', 10);
  const packVersion = Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  return { packId, packVersion };
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export const handler = async (event: FunctionUrlEvent): Promise<FunctionUrlResult> => {
  try {
    const method = (event.requestContext?.http?.method ?? 'POST').toUpperCase();

    // Preflight is answered before anything else is read: an extension content
    // script on an arbitrary origin sends one for every session it starts, and
    // it must not be able to fail on a malformed body it never sent.
    if (method === 'OPTIONS') {
      return { statusCode: 204, headers: CORS_HEADERS, body: '' };
    }
    if (method !== 'POST') {
      return fail(405, 'method_not_allowed', 'This endpoint accepts POST and OPTIONS.');
    }

    const rawBody = event.isBase64Encoded && event.body
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body ?? '';

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return fail(400, 'invalid_body', 'Request body must be a JSON object.');
    }

    const sessionId = typeof body['sessionId'] === 'string' ? body['sessionId'].trim() : '';
    if (sessionId.length === 0) {
      return fail(400, 'invalid_session', 'sessionId is required and must be a non-empty string.');
    }

    const audioBase64 = typeof body['audio'] === 'string' ? body['audio'] : '';
    if (audioBase64.length === 0) {
      return fail(400, 'invalid_audio', 'audio is required and must be base64-encoded pcm16 audio.');
    }

    // Checked on the encoded length first so an oversized request is refused
    // without allocating the decoded buffer it was trying to make us hold.
    if (audioBase64.length > MAX_AUDIO_BASE64_CHARS) {
      return fail(
        400,
        'audio_too_large',
        `Audio exceeds the ${MAX_AUDIO_BYTES} byte limit (about ${Math.floor(
          MAX_AUDIO_BYTES / 2 / SAMPLE_RATE_HZ,
        )} seconds of pcm16 ${SAMPLE_RATE_HZ}Hz mono). Send shorter chunks.`,
      );
    }

    const audio = new Uint8Array(Buffer.from(audioBase64, 'base64'));
    if (audio.byteLength === 0) {
      return fail(400, 'invalid_audio', 'audio did not decode to any bytes.');
    }
    if (audio.byteLength > MAX_AUDIO_BYTES) {
      return fail(
        400,
        'audio_too_large',
        `Audio is ${audio.byteLength} bytes, over the ${MAX_AUDIO_BYTES} byte limit. Send shorter chunks.`,
      );
    }

    const lang = typeof body['lang'] === 'string' && body['lang'].trim().length >= 2
      ? body['lang'].trim()
      : DEFAULT_LANGUAGE;
    const startSequence = nonNegativeInteger(body['startSequence']) ?? 0;
    const { packId, packVersion } = packIdentity();

    let events: CaptionAppendedEvent[];
    try {
      const results = await transcribeChunk(audio, lang);
      events = toCaptionEvents(results, sessionId, packId, packVersion, startSequence);
    } catch (error) {
      // Only the error's name reaches the log. An SDK error message can quote
      // the request it failed on, and the request is the lecture.
      log.error('transcribe-failed', {
        sessionId,
        audioBytes: audio.byteLength,
        reason: error instanceof Error ? error.name : 'unknown',
      });
      return fail(502, 'transcription_failed', 'Transcription is unavailable. Captions will resume.');
    }

    // Logged through `logEvent` rather than by hand so the caption cannot be
    // named here even by accident; the last event carries the highest sequence,
    // which is the number worth having when captions look stalled.
    const last = events.at(-1);
    if (last === undefined) {
      log.info('captions-empty', { sessionId, audioBytes: audio.byteLength });
    } else {
      logEvent('info', 'captions-emitted', last, { count: events.length });
    }

    const response: CaptionsResponse = { captions: events.map((emitted) => emitted.caption) };
    return json(200, response);
  } catch (error) {
    // Nothing above should reach here, which is exactly why it exists: an
    // unhandled throw from a Function URL is a 502 with an AWS body the
    // extension cannot parse, and a caption client that cannot parse a failure
    // retries forever.
    log.error('captions-unhandled', { reason: error instanceof Error ? error.name : 'unknown' });
    return fail(502, 'captions_unavailable', 'Captions are temporarily unavailable.');
  }
};
