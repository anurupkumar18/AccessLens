/**
 * Translate-and-speak endpoint for instructor-reviewed text.
 *
 * Why this service is allowed to exist at all:
 *
 * AccessLens's core promise (charter A9) is that it never hands a student an
 * invented description. The orb's explanation endpoint had to amend that promise
 * to "never invents *silently*", because it generates new content about pages no
 * instructor has ever seen. This service does not need that amendment. Its input
 * is text an instructor already reviewed and approved, and translation is a
 * transformation of that text, not a replacement for it. The meaning a student
 * hears is still the meaning the instructor signed off on, expressed in a
 * language they can actually read.
 *
 * That distinction is load-bearing and is carried in the response as
 * `provenance: 'reviewed-translated'` — never `'generated'`. The extension's
 * provenance module (`apps/extension/src/orb/provenance.ts`) draws the same line
 * between reviewed and generated content; this service mirrors the concept
 * rather than importing it, because a Lambda bundle and a browser bundle sharing
 * a module across service boundaries is a deployment coupling neither wants.
 * The third value exists because 'reviewed' would overclaim (machine translation
 * can mistranslate, and the student deserves to know a machine touched it) while
 * 'generated' would underclaim (nothing here was invented).
 *
 * What this deliberately does NOT do:
 *   - store anything. No request, translation, or audio is written anywhere.
 *   - log the text. Only `{event, targetLang, chars, spoke}` reaches CloudWatch,
 *     enforced by the allowlist projection in `log.ts`.
 *   - fail the request because speech failed. A translation the student can read
 *     is worth far more than a 502 that loses it.
 */

import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { logOperation } from './log';
import { pickVoice, type PickedVoice } from './voices';
import { MAX_INPUT_CHARS, POLLY_TEXT_LIMIT, splitForSpeech } from './text';

export { pickVoice, type PickedVoice } from './voices';
export { splitForSpeech, MAX_INPUT_CHARS } from './text';

const translate = new TranslateClient({});
const polly = new PollyClient({});

/**
 * Provenance for this service's output. Not `'generated'`: nothing here is
 * invented. Not `'reviewed'`: a machine changed the words.
 */
export type TranslatedProvenance = 'reviewed-translated';

/**
 * Spoken and displayed before the content, matching the extension's habit of
 * putting the caveat first so an audio-only user hears it before the content
 * rather than after they have already taken it as fact.
 */
export const TRANSLATED_NOTICE =
  'Machine-translated from your instructor’s reviewed material.';

/** Polly engines this service will ask for. */
export type VoiceEngine = 'neural' | 'standard';

export interface TranslateSpeakRequest {
  text?: unknown;
  targetLang?: unknown;
  sourceLang?: unknown;
  speak?: unknown;
  voice?: unknown;
}

export interface TranslateSpeakResponse {
  provenance: TranslatedProvenance;
  notice: string;
  sourceLang: string;
  targetLang: string;
  translatedText: string;
  /** Present whenever speech was requested, even if it could not be produced. */
  voiceId?: string;
  /** Which Polly engine actually produced the audio. */
  voiceEngine?: VoiceEngine;
  audioBase64?: string;
  contentType?: 'audio/mpeg';
  /** True when `speak` was requested but Polly could not deliver. */
  speechUnavailable?: boolean;
}

export interface HttpEvent {
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext?: { http?: { method?: string } };
}

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
const CORS: Record<string, string> = {};

const json = (status: number, body: unknown) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json', ...CORS },
  body: JSON.stringify(body),
});

/** One `SynthesizeSpeech` call, returned as raw MP3 bytes. */
async function synthesize(text: string, voiceId: string, engine: VoiceEngine): Promise<Buffer> {
  const response = await polly.send(
    new SynthesizeSpeechCommand({
      Text: text,
      TextType: 'text',
      VoiceId: voiceId as never,
      Engine: engine,
      OutputFormat: 'mp3',
      // `LanguageCode` is deliberately omitted. It is only meaningful for
      // bilingual voices, and passing one that disagrees with the voice is a
      // hard error — the voice id already determines the language.
    }),
  );
  const stream = response.AudioStream;
  if (!stream) throw new Error('polly-returned-no-audio');
  return Buffer.from(await stream.transformToByteArray());
}

/**
 * Speak the translated text, degrading rather than failing.
 *
 * Two degradations are built in. First, engine: Polly rejects `neural` outright
 * for standard-only voices (Russian and Modern Standard Arabic have no neural
 * build at all), so an unknown or misjudged voice retries on `standard` instead
 * of returning nothing. Second, length: translation expands text, so the result
 * can exceed Polly's 3000-character ceiling even though the request did not —
 * see `text.ts` for why concatenating the MP3s is safe.
 */
async function speakText(
  text: string,
  voice: PickedVoice,
  targetLang: string,
): Promise<{ audioBase64: string; engine: VoiceEngine }> {
  const chunks = splitForSpeech(text, POLLY_TEXT_LIMIT);
  let engine: VoiceEngine = voice.supportsNeural ? 'neural' : 'standard';
  const parts: Buffer[] = [];

  for (const chunk of chunks) {
    try {
      parts.push(await synthesize(chunk, voice.voiceId, engine));
    } catch (error) {
      if (engine === 'standard') throw error;
      // Neural refused. This is a property of the voice, not of the chunk, so
      // in practice it happens on the first chunk and the whole clip is
      // standard. Downgrading mid-clip is still better than no audio.
      engine = 'standard';
      logOperation({ event: 'speak_engine_downgraded', targetLang, chars: chunk.length });
      parts.push(await synthesize(chunk, voice.voiceId, 'standard'));
    }
  }

  return { audioBase64: Buffer.concat(parts).toString('base64'), engine };
}

export async function handler(event: HttpEvent) {
  const method = event.requestContext?.http?.method;
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (method && method !== 'POST') {
    return json(405, { error: 'Use POST.' });
  }

  // Function URLs base64-encode the body only for binary content types, but a
  // caller that sets an odd `content-type` on JSON would otherwise arrive as
  // unparseable noise.
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : (event.body ?? '');

  let request: TranslateSpeakRequest;
  try {
    request = JSON.parse(raw || '{}') as TranslateSpeakRequest;
  } catch {
    return json(400, { error: 'Body must be JSON.' });
  }

  const text = typeof request.text === 'string' ? request.text.trim() : '';
  if (!text) {
    return json(400, { error: 'A non-empty "text" is required.' });
  }
  if (text.length > MAX_INPUT_CHARS) {
    // Not silently truncated: this endpoint serves reviewed material, and
    // dropping the tail of an instructor's sentence without saying so is worse
    // than refusing. The caller knows how to split its own UI text.
    return json(400, {
      error: `"text" is ${text.length} characters; the limit is ${MAX_INPUT_CHARS}.`,
      limit: MAX_INPUT_CHARS,
      chars: text.length,
    });
  }

  const targetLang = typeof request.targetLang === 'string' ? request.targetLang.trim() : '';
  if (!targetLang) {
    return json(400, { error: 'A "targetLang" language code is required.' });
  }

  // `auto` asks Translate to detect the source. Reviewed material does not
  // always carry a declared language, and guessing wrong here would produce
  // confident nonsense, so detection is the default rather than assuming English.
  const sourceLang =
    typeof request.sourceLang === 'string' && request.sourceLang.trim()
      ? request.sourceLang.trim()
      : 'auto';

  const speak = request.speak === true;
  const requestedVoice = typeof request.voice === 'string' ? request.voice : undefined;

  let translatedText: string;
  let detectedSource: string;
  try {
    const result = await translate.send(
      new TranslateTextCommand({
        Text: text,
        SourceLanguageCode: sourceLang,
        TargetLanguageCode: targetLang,
      }),
    );
    translatedText = result.TranslatedText ?? '';
    detectedSource = result.SourceLanguageCode ?? sourceLang;
  } catch {
    logOperation({ event: 'translate_failed', targetLang, chars: text.length, spoke: false });
    return json(502, { error: 'The translation service could not be reached.' });
  }

  if (!translatedText.trim()) {
    logOperation({ event: 'translate_empty', targetLang, chars: text.length, spoke: false });
    return json(502, { error: 'The translation service returned nothing usable.' });
  }

  const response: TranslateSpeakResponse = {
    provenance: 'reviewed-translated',
    notice: TRANSLATED_NOTICE,
    sourceLang: detectedSource,
    targetLang,
    translatedText,
  };

  let spoke = false;
  if (speak) {
    const voice = pickVoice(targetLang, requestedVoice);
    response.voiceId = voice.voiceId;
    try {
      const { audioBase64, engine } = await speakText(translatedText, voice, targetLang);
      response.audioBase64 = audioBase64;
      response.contentType = 'audio/mpeg';
      response.voiceEngine = engine;
      spoke = true;
    } catch {
      // Speech is the enhancement; the translation is the product. Returning
      // 502 here would throw away a correct translation because a voice was
      // unavailable, so the caller gets the text and an explicit flag instead.
      response.speechUnavailable = true;
      logOperation({ event: 'speak_failed', targetLang, chars: translatedText.length, spoke: false });
    }
  }

  // Content is never logged; the shape of the call is.
  logOperation({ event: 'translated', targetLang, chars: text.length, spoke });
  return json(200, response);
}
