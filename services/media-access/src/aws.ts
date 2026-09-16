/**
 * The only file that talks to AWS.
 *
 * Bedrock writes the alt text; Transcribe streaming times the words. Streaming
 * rather than batch Transcribe because batch needs the lecture in S3, and this
 * service is built to hold nothing: the extension sends one chunk, gets words
 * back, and the chunk is gone when the invocation ends.
 */
import { BedrockRuntimeClient, ConverseCommand, type ImageFormat } from '@aws-sdk/client-bedrock-runtime';
import {
  StartStreamTranscriptionCommand,
  TranscribeStreamingClient,
  type AudioStream,
  type LanguageCode,
} from '@aws-sdk/client-transcribe-streaming';
import { SYSTEM_PROMPT, TOOL_INPUT_SCHEMA, TOOL_NAME, userPrompt } from './altText.js';
import type { TranscriptResultLike } from './words.js';

/** The one Anthropic model invocable in the hackathon account; see orb-explain. */
const MODEL_ID = process.env['MEDIA_MODEL_ID'] ?? 'us.anthropic.claude-sonnet-4-6';

export const SAMPLE_RATE_HZ = 16000;

let bedrock: BedrockRuntimeClient | undefined;
let transcribe: TranscribeStreamingClient | undefined;

/** Returns the tool call's raw input; `altText.ts` decides whether it is usable. */
export async function requestAltText(image: Uint8Array, format: ImageFormat, context: string): Promise<unknown> {
  bedrock ??= new BedrockRuntimeClient({});
  const response = await bedrock.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: SYSTEM_PROMPT }],
      messages: [
        {
          role: 'user',
          content: [
            { image: { format, source: { bytes: image } } },
            { text: userPrompt(context) },
          ],
        },
      ],
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: TOOL_NAME,
              description: 'Submit the draft alt text for this image.',
              inputSchema: { json: TOOL_INPUT_SCHEMA as unknown as Record<string, never> },
            },
          },
        ],
        toolChoice: { tool: { name: TOOL_NAME } },
      },
      inferenceConfig: { maxTokens: 1200, temperature: 0.2 },
    }),
  );
  return response.output?.message?.content?.find(part => part.toolUse)?.toolUse?.input;
}

/** Half-second frames: an AudioEvent over a second is refused (see services/captions). */
const FRAME_BYTES = SAMPLE_RATE_HZ;

async function* frames(audio: Uint8Array): AsyncIterable<AudioStream> {
  for (let offset = 0; offset < audio.byteLength; offset += FRAME_BYTES) {
    yield { AudioEvent: { AudioChunk: audio.subarray(offset, Math.min(offset + FRAME_BYTES, audio.byteLength)) } };
  }
}

/** Transcribe one chunk of pcm16/16kHz/mono audio, keeping item timings. */
export async function transcribeWithTimings(audio: Uint8Array, languageCode: string): Promise<TranscriptResultLike[]> {
  transcribe ??= new TranscribeStreamingClient({});
  const response = await transcribe.send(
    new StartStreamTranscriptionCommand({
      LanguageCode: languageCode as LanguageCode,
      MediaEncoding: 'pcm',
      MediaSampleRateHertz: SAMPLE_RATE_HZ,
      AudioStream: frames(audio),
    }),
  );

  const results: TranscriptResultLike[] = [];
  for await (const event of response.TranscriptResultStream ?? []) {
    for (const result of event.TranscriptEvent?.Transcript?.Results ?? []) {
      results.push({
        IsPartial: result.IsPartial,
        Alternatives: result.Alternatives?.map(alternative => ({
          Items: alternative.Items?.map(item => ({
            Content: item.Content,
            Type: item.Type,
            StartTime: item.StartTime,
            EndTime: item.EndTime,
          })),
        })),
      });
    }
  }
  return results;
}
