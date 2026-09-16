import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { ArtifactManifestSchema, type ArtifactManifest } from '../../apps/extension/src/shared/contracts';
import type { RenderCheck } from './browser';

export const HarnessEventSchema = z.object({
  artifactId: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/u),
  artifactVersion: z.number().int().positive(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  jobId: z.string().min(1),
}).strict();
export type HarnessEvent = z.infer<typeof HarnessEventSchema>;

export interface HarnessResult {
  ok: boolean;
  consoleErrors: string[];
  unhandledRejections: string[];
  screenshotPath?: string;
  screenshotKey?: string;
}

export interface HarnessS3Transport {
  send(command: unknown): Promise<unknown>;
}

export interface HarnessOptions {
  s3: HarnessS3Transport;
  render: RenderCheck;
  artifactsBucket: string;
  /** Lambda uses /tmp; tests inject an isolated directory. */
  tempRoot?: string;
}

const defaultS3: HarnessS3Transport = new S3Client({}) as unknown as HarnessS3Transport;

interface S3ObjectResponse { Body?: unknown }
interface ListedObject { Key?: string }

async function bodyBytes(body: unknown): Promise<Buffer> {
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body && typeof body === 'object' && 'transformToByteArray' in body) {
    const transform = (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray;
    return Buffer.from(await transform.call(body));
  }
  if (body && typeof body === 'object' && 'transformToString' in body) {
    const transform = (body as { transformToString: () => Promise<string> }).transformToString;
    return Buffer.from(await transform.call(body));
  }
  if (body && typeof body === 'object' && Symbol.asyncIterator in body) {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error('S3 object response did not contain a readable body');
}

async function downloadObject(s3: HarnessS3Transport, bucket: string, key: string, destination: string): Promise<void> {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key })) as S3ObjectResponse;
  if (!response.Body) throw new Error(`S3 object ${key} had no body`);
  await mkdir(resolve(destination, '..'), { recursive: true });
  await writeFile(destination, await bodyBytes(response.Body));
}

function artifactPrefix(event: HarnessEvent): string {
  return `artifacts/${event.artifactId}/${event.artifactVersion}/`;
}

function localPathForKey(root: string, prefix: string, key: string): string {
  if (!key.startsWith(prefix)) throw new Error(`artifact object ${key} is outside ${prefix}`);
  const suffix = key.slice(prefix.length);
  if (!suffix || suffix.startsWith('/') || suffix.split('/').includes('..')) throw new Error(`unsafe artifact object key ${key}`);
  const destination = resolve(root, suffix);
  const rootResolved = resolve(root);
  if (destination !== rootResolved && !destination.startsWith(`${rootResolved}/`)) throw new Error(`unsafe artifact object key ${key}`);
  return destination;
}

async function loadArtifact(
  s3: HarnessS3Transport,
  bucket: string,
  event: HarnessEvent,
  root: string,
): Promise<ArtifactManifest> {
  const prefix = artifactPrefix(event);
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix })) as { Contents?: ListedObject[] };
  const keys = (listed.Contents ?? []).flatMap(object => object.Key ? [object.Key] : []);
  if (!keys.includes(`${prefix}manifest.json`)) throw new Error(`artifact ${prefix} has no manifest.json`);

  for (const key of keys) {
    // Screenshots are outputs of this Lambda, not artifact source files. Do not
    // feed an old screenshot back into the viewer on a repeated job id.
    if (key.startsWith(`${prefix}screenshots/`)) continue;
    await downloadObject(s3, bucket, key, localPathForKey(root, prefix, key));
  }

  const manifestPath = join(root, 'manifest.json');
  const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
  const parsed = ArtifactManifestSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`stored artifact manifest ${prefix}manifest.json is invalid: ${parsed.error.message}`);
  const entryPath = localPathForKey(root, prefix, `${prefix}${parsed.data.render.entry}`);
  try {
    await readFile(entryPath);
  } catch {
    throw new Error(`stored artifact ${prefix} is missing ${parsed.data.render.entry}`);
  }
  return parsed.data;
}

function requiredEnvironment(): string {
  const bucket = process.env.ARTIFACTS_BUCKET;
  if (!bucket) throw new Error('Missing required environment variable ARTIFACTS_BUCKET');
  return bucket;
}

/**
 * Harness Lambda: stage one artifact from S3, run the viewer's RenderCheck, and
 * persist the screenshot next to the artifact. The RenderCheck is injected so
 * the critic and this Lambda share the exact same driver interface.
 */
export async function handleHarness(event: HarnessEvent, options: HarnessOptions): Promise<HarnessResult> {
  const parsedEvent = HarnessEventSchema.parse(event);
  if (!options.artifactsBucket) throw new Error('artifactsBucket is required');
  const workRoot = resolve(options.tempRoot ?? tmpdir(), `accesslens-harness-${parsedEvent.jobId}-${parsedEvent.artifactId}-${parsedEvent.artifactVersion}`);
  await rm(workRoot, { recursive: true, force: true });
  await mkdir(workRoot, { recursive: true });
  try {
    const manifest = await loadArtifact(options.s3, options.artifactsBucket, parsedEvent, workRoot);
    const parameters = parsedEvent.parameters ?? { ...manifest.defaultParameters };
    const render = await options.render({ artifactDir: workRoot, parameters });
    const result: HarnessResult = {
      ok: render.ok,
      consoleErrors: [...render.consoleErrors],
      unhandledRejections: [...render.unhandledRejections],
      ...(render.screenshotPath ? { screenshotPath: render.screenshotPath } : {}),
    };
    if (render.ok && render.screenshotPath) {
      const screenshot = await readFile(render.screenshotPath);
      const screenshotKey = `${artifactPrefix(parsedEvent)}screenshots/${parsedEvent.jobId}.png`;
      await options.s3.send(new PutObjectCommand({
        Bucket: options.artifactsBucket,
        Key: screenshotKey,
        Body: screenshot,
        ContentType: 'image/png',
      }));
      result.screenshotKey = screenshotKey;
    }
    return result;
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}

/** Lambda handler. Production wiring supplies the real Chromium RenderCheck. */
export async function handler(event: HarnessEvent): Promise<HarnessResult> {
  // The browser dependency is deliberately not constructed at module load:
  // deployment can import this handler for health checks without starting a
  // Chromium process. The container entry point sets a real implementation.
  const { chromiumRenderCheck } = await import('./browser');
  return handleHarness(event, {
    s3: defaultS3,
    render: chromiumRenderCheck(),
    artifactsBucket: requiredEnvironment(),
  });
}
