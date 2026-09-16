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
 * One buffered utterance, one event stream, closed immediately.
 *
 * The extension posts a complete chunk per request rather than holding a socket
 * open, so the generator yields once and returns -- and that return is what
 * tells Transcribe the audio has ended, which is what makes it flush a final
 * (non-partial) result instead of leaving the last sentence interim forever.
 */
async function* singleChunk(audio: Uint8Array): AsyncIterable<AudioStream> {
  yield { AudioEvent: { AudioChunk: audio } };
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
      AudioStream: singleChunk(audio),
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
