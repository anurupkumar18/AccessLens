import { PollyClient, SynthesizeSpeechCommand, type SynthesizeSpeechCommandInput } from '@aws-sdk/client-polly';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { AccessPack } from '../../apps/extension/src/shared/contracts';

export type AudioAsset = AccessPack['assets'][number];

/** The small Polly seam used by unit tests and by the Lambda adapter. */
export interface PollyTransport {
  synthesize(input: Record<string, unknown>): Promise<Uint8Array>;
}

export interface AudioObjectWriter {
  (write: { key: string; body: Uint8Array; contentType: string }): Promise<void>;
}

export interface SynthesizeSlideAudioInput {
  jobId: string;
  packId: string;
  asset: AudioAsset;
}

export interface AudioRegionFailure {
  regionId: string;
  error: string;
}

export interface SynthesizeSlideAudioResult {
  asset: AudioAsset;
  status: 'ok';
  failures: AudioRegionFailure[];
}

export interface AudioOptions {
  polly?: PollyTransport;
  putObject?: AudioObjectWriter;
  /** Override the staging media prefix for a test or a separate temporary job namespace. */
  mediaPrefix?: string;
}

/**
 * Polly neural English voice chosen for this first language slot. Joanna is a
 * stable neural en-US voice; later language support can reuse the same stage
 * while selecting a locale/voice from an explicit job setting.
 */
export const DEFAULT_VOICE = 'Joanna';
export const DEFAULT_LANGUAGE_CODE = 'en-US';
export const DEFAULT_ENGINE = 'neural';
export const DEFAULT_OUTPUT_FORMAT = 'mp3';

function defaultPollyTransport(): PollyTransport {
  // Construct the client only when a Lambda stage is actually invoked. No AWS
  // call, credential lookup, or network activity happens at module load time.
  const client = new PollyClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
  return {
    async synthesize(input) {
      const response = await client.send(new SynthesizeSpeechCommand(input as unknown as SynthesizeSpeechCommandInput));
      if (!response.AudioStream) throw new Error('Polly returned no AudioStream');
      return bodyBytes(response.AudioStream);
    },
  };
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
  throw new Error('Polly returned an unreadable AudioStream');
}

function safePart(value: string): string {
  // Author output normally uses lowercase kebab-case region ids. Replacing
  // separators here keeps a malformed/manual id inside the job prefix rather
  // than allowing it to escape into another S3 key.
  return value.replace(/[^a-zA-Z0-9._-]/gu, '-');
}

function audioKey(jobId: string, assetId: string, regionId: string, prefix?: string): string {
  const root = (prefix ?? `staging/${safePart(jobId)}/media`).replace(/^\/+|\/+$/gu, '');
  const expected = `staging/${safePart(jobId)}/`;
  if (!root.startsWith(expected) || root.includes('..')) {
    throw new Error(`audio media prefix must be under ${expected}; received ${root}`);
  }
  return `${root}/${safePart(assetId)}.${safePart(regionId)}.mp3`;
}

/**
 * Synthesize one clip per region shortDescription. Polly errors are isolated to
 * that region: Hear mode intentionally falls back to local speech when an
 * optional clip is unavailable. Storage errors remain fatal because they would
 * make a successful audio reference impossible to publish.
 */
export async function synthesizeSlideAudio(
  input: SynthesizeSlideAudioInput,
  options: AudioOptions = {},
): Promise<SynthesizeSlideAudioResult> {
  const polly = options.polly ?? defaultPollyTransport();
  if (!options.putObject) throw new Error('putObject is required for audio staging');
  const regions = input.asset.regions.map(region => ({ ...region }));
  const failures: AudioRegionFailure[] = [];

  for (const [index, region] of regions.entries()) {
    const key = audioKey(input.jobId, input.asset.assetId, region.regionId, options.mediaPrefix);
    let bytes: Uint8Array;
    try {
      bytes = await polly.synthesize({
          Text: region.shortDescription,
          TextType: 'text',
          OutputFormat: DEFAULT_OUTPUT_FORMAT,
          VoiceId: DEFAULT_VOICE,
          Engine: DEFAULT_ENGINE,
          LanguageCode: DEFAULT_LANGUAGE_CODE,
        });
      } catch (error) {
        // A Polly failure must not fail a slide, and should not leave a dangling
        // URI. Existing audio from a previous draft is also removed so a retry
        // cannot accidentally publish stale speech for edited text.
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ regionId: region.regionId, error: message });
        const { audioUri: _audioUri, ...withoutAudio } = regions[index];
        regions[index] = withoutAudio;
        continue;
      }
    // Storage failure is not equivalent to a failed synthesis: swallowing it
    // would report a successful stage while losing the only copy of audio.
    await options.putObject({ key, body: bytes, contentType: 'audio/mpeg' });
    regions[index] = { ...region, audioUri: key };
  }

  return { asset: { ...input.asset, regions }, status: 'ok', failures };
}

export interface AudioEvent extends SynthesizeSlideAudioInput {
  bucket?: string;
  outputKey?: string;
  mediaPrefix?: string;
}

interface S3Transport { send(command: unknown): Promise<unknown> }

export interface AudioHandlerOptions {
  polly?: PollyTransport;
  s3Client?: S3Transport;
  putObject?: AudioObjectWriter;
}

/** Lambda boundary for stage 4. The only default AWS clients are created here. */
export async function handleAudio(event: AudioEvent, options: AudioHandlerOptions = {}): Promise<SynthesizeSlideAudioResult> {
  const bucket = event.bucket ?? process.env.PACKS_BUCKET;
  if (!bucket && !options.putObject) throw new Error('Missing required PACKS_BUCKET environment variable');
  const s3 = options.s3Client ?? (options.putObject ? undefined : new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' }));
  const putObject = options.putObject ?? (async write => {
    await s3!.send(new PutObjectCommand({
      Bucket: bucket,
      Key: write.key,
      Body: write.body,
      ContentType: write.contentType,
    }));
  });
  const result = await synthesizeSlideAudio(event, {
    polly: options.polly,
    putObject,
    mediaPrefix: event.mediaPrefix ?? `staging/${event.jobId}/media`,
  });
  const outputKey = event.outputKey ?? `staging/${event.jobId}/draft/${event.asset.assetId}.json`;
  await putObject({
    key: outputKey,
    body: new TextEncoder().encode(JSON.stringify(result.asset) + '\n'),
    contentType: 'application/json',
  });
  return result;
}

export async function handler(event: AudioEvent): Promise<SynthesizeSlideAudioResult> {
  return handleAudio(event);
}
