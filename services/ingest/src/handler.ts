import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { ingestDeck, type IngestDeckOptions, type RunCommand } from './ingest';
import type { Deck } from '../../shared/jobs';

export interface IngestEvent {
  jobId: string;
  packId: string;
  title: string;
  /** Object key in the instructor-upload `decks` bucket. */
  sourceKey: string;
}

interface S3Transport {
  send(command: unknown): Promise<unknown>;
}

export interface HandlerOptions {
  s3Client?: S3Transport;
  /** Test-only override; Lambda uses /tmp. */
  tempRoot?: string;
  /** Test-only command seam forwarded to ingestDeck. */
  runCommand?: RunCommand;
  /** Test-only profile directory forwarded to ingestDeck. */
  libreOfficeProfileDir?: string;
}

const defaultS3Client = new S3Client({});

function requiredEnvironment(name: 'DECKS_BUCKET' | 'PACKS_BUCKET'): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

async function bodyBytes(body: unknown): Promise<Buffer> {
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body && typeof body === 'object' && 'transformToByteArray' in body) {
    const transform = (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray;
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

async function downloadSource(s3: S3Transport, bucket: string, key: string, path: string): Promise<void> {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key })) as { Body?: unknown };
  if (!response.Body) throw new Error(`S3 object ${key} had no body`);
  writeFileSync(path, await bodyBytes(response.Body));
}

/**
 * Ingests one uploaded deck and leaves all outputs under staging/{jobId}/.
 * No published `packs/`, `media/`, or `artifacts/` key is ever written here.
 */
export async function handleIngest(event: IngestEvent, options: HandlerOptions = {}): Promise<Deck> {
  if (!event.jobId || !event.packId || !event.title || !event.sourceKey) {
    throw new Error('jobId, packId, title, and sourceKey are required');
  }
  const decksBucket = requiredEnvironment('DECKS_BUCKET');
  const packsBucket = requiredEnvironment('PACKS_BUCKET');
  const s3 = options.s3Client ?? (defaultS3Client as unknown as S3Transport);
  const workDir = join(options.tempRoot ?? tmpdir(), `accesslens-ingest-${event.jobId}`);
  const renderDir = join(workDir, 'rendered');
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(renderDir, { recursive: true });
  const sourcePath = join(workDir, basename(event.sourceKey) || 'source.bin');
  await downloadSource(s3, decksBucket, event.sourceKey, sourcePath);

  const ingestOptions: IngestDeckOptions = {
    sourcePath,
    sourceKey: event.sourceKey,
    jobId: event.jobId,
    packId: event.packId,
    title: event.title,
    outputDir: renderDir,
    mediaKeyPrefix: `staging/${event.jobId}/media`,
    runCommand: options.runCommand,
    libreOfficeProfileDir: options.libreOfficeProfileDir,
  };
  const deck = ingestDeck(ingestOptions);

  for (const slide of deck.slides) {
    await s3.send(new PutObjectCommand({
      Bucket: packsBucket,
      Key: slide.mediaKey,
      Body: readFileSync(join(renderDir, `${slide.assetId}.png`)),
      ContentType: 'image/png',
    }));
  }
  await s3.send(new PutObjectCommand({
    Bucket: packsBucket,
    Key: `staging/${event.jobId}/deck.json`,
    Body: JSON.stringify(deck) + '\n',
    ContentType: 'application/json',
  }));
  return deck;
}

/** Lambda handler used by the container image. */
export async function handler(event: IngestEvent): Promise<Deck> {
  return handleIngest(event);
}
