/**
 * The only file that talks to AWS.
 *
 * Everything decision-shaped lives in `captions.ts`; this is the adapter that
 * opens a Transcribe stream, drains it, and hands back plain objects. Keeping
 * the boundary this thin is what lets the caption rules be tested without a
 * credential.
 */
import {
  StartStreamTranscriptionCommand,
  TranscribeStreamingClient,
  type AudioStream,
  type LanguageCode,
} from '@aws-sdk/client-transcribe-streaming';
import type { TranscriptResultLike } from './captions.js';

/** The extension captures pcm16 mono at this rate; Transcribe must be told so. */
export const SAMPLE_RATE_HZ = 16000;

/** Transcribe wants a regioned code ('en-US'), not a bare ISO-639 tag. */
export const DEFAULT_LANGUAGE = 'en-US';

let client: TranscribeStreamingClient | undefined;

/**
 * Built on first use, not at module load: a cold start that only ever answers a
 * CORS preflight should not resolve credentials, and tests should be able to
 * import this module without the SDK reaching for an IMDS endpoint.
 */
function getClient(): TranscribeStreamingClient {
  client ??= new TranscribeStreamingClient({});
  return client;
}

/**
 * Sample rate and frame size the API is documented against.
 *
 * An `AudioEvent` carries at most one second of audio. A whole utterance in a
 * single event is rejected with `BadRequestException` -- which is exactly what
 * the first live call returned -- so the buffer is cut into sub-second frames
 * before being streamed.
 *
 * Half a second rather than a full one: the limit is documented in seconds but
 * enforced on bytes, and leaving headroom costs nothing when the frames are
 * being streamed back to back anyway.
 */
const BYTES_PER_SAMPLE = 2; // pcm16
const FRAME_BYTES = (SAMPLE_RATE_HZ * BYTES_PER_SAMPLE) / 2;

/** Cut a buffered utterance into frames Transcribe will accept. */
export function frameAudio(audio: Uint8Array, frameBytes = FRAME_BYTES): Uint8Array[] {
  if (audio.byteLength === 0) return [];
  const frames: Uint8Array[] = [];
  for (let offset = 0; offset < audio.byteLength; offset += frameBytes) {
    frames.push(audio.subarray(offset, Math.min(offset + frameBytes, audio.byteLength)));
  }
  return frames;
}

/**
 * One buffered utterance, streamed as sub-second frames, then closed.
 *
 * The extension posts a complete chunk per request rather than holding a
 * socket open, so the generator drains its frames and returns -- and that
 * return is what tells Transcribe the audio has ended, which is what makes it
 * flush a final (non-partial) result instead of leaving the last sentence
 * interim forever.
 */
async function* framedChunks(audio: Uint8Array): AsyncIterable<AudioStream> {
  for (const frame of frameAudio(audio)) {
    yield { AudioEvent: { AudioChunk: frame } };
  }
}

/**
 * Transcribe one chunk of pcm16/16kHz/mono audio.
 *
 * Results are copied into plain objects rather than passed through: the SDK's
 * `Result` carries timings, entities and PII-redaction fields this system has no
 * use for, and the narrower the thing that crosses into `captions.ts`, the fewer
 * ways lesson content has to end up somewhere it was never meant to go.
 */
export async function transcribeChunk(
  audio: Uint8Array,
  languageCode: string,
): Promise<TranscriptResultLike[]> {
  const response = await getClient().send(
    new StartStreamTranscriptionCommand({
      // Cast rather than validate: the caller supplies a Transcribe language
      // code, and re-encoding the service's full enum here would be a list that
      // silently rots every time AWS adds a language.
      LanguageCode: languageCode as LanguageCode,
      MediaEncoding: 'pcm',
      MediaSampleRateHertz: SAMPLE_RATE_HZ,
      AudioStream: framedChunks(audio),
    }),
  );

  const results: TranscriptResultLike[] = [];
  const stream = response.TranscriptResultStream;
  if (stream === undefined) return results;

  for await (const event of stream) {
    for (const result of event.TranscriptEvent?.Transcript?.Results ?? []) {
      results.push({
        IsPartial: result.IsPartial,
        Alternatives: result.Alternatives?.map((alternative) => ({
          Transcript: alternative.Transcript,
        })),
        // Transcribe only echoes a language when identification is on; fall back
        // to what was asked for so the caption is always labelled for a student
        // reading in a second language.
        LanguageCode: result.LanguageCode ?? languageCode,
      });
    }
  }

  return results;
}
