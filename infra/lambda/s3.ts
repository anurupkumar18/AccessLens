import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

export interface S3Transport {
  send(command: unknown): Promise<unknown>;
}

const defaultS3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });

export async function bodyBytes(body: unknown): Promise<Uint8Array> {
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
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }
  throw new Error('S3 object response did not contain a readable body');
}

export async function readObject(
  bucket: string,
  key: string,
  s3: S3Transport = defaultS3 as unknown as S3Transport,
): Promise<Uint8Array> {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key })) as { Body?: unknown };
  if (!response.Body) throw new Error(`S3 object ${key} had no body`);
  return bodyBytes(response.Body);
}

export async function listObjects(
  bucket: string,
  prefix: string,
  s3: S3Transport = defaultS3 as unknown as S3Transport,
): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const response = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
    })) as { Contents?: Array<{ Key?: string }>; IsTruncated?: boolean; NextContinuationToken?: string };
    for (const item of response.Contents ?? []) if (item.Key) keys.push(item.Key);
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

export async function writeObject(
  bucket: string,
  key: string,
  body: Uint8Array | string,
  contentType: string,
  s3: S3Transport = defaultS3 as unknown as S3Transport,
): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

async function filesUnder(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(root, path));
    else files.push(path);
  }
  return files;
}

function contentType(key: string): string {
  if (key.endsWith('.json')) return 'application/json';
  if (key.endsWith('.html')) return 'text/html; charset=utf-8';
  if (key.endsWith('.css')) return 'text/css; charset=utf-8';
  if (key.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (key.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

/** Upload a complete artifact directory beneath one job-scoped staging root. */
export async function uploadDirectory(
  bucket: string,
  rootKey: string,
  directory: string,
  s3: S3Transport = defaultS3 as unknown as S3Transport,
): Promise<void> {
  const root = resolve(directory);
  const files = await filesUnder(root);
  for (const file of files) {
    const suffix = relative(root, file).split('\\').join('/');
    if (!suffix || suffix.split('/').includes('..')) throw new Error(`unsafe artifact file ${suffix}`);
    await writeObject(bucket, `${rootKey.replace(/\/+$/u, '')}/${suffix}`, await readFile(file), contentType(suffix), s3);
  }
}

/** Materialize an S3 artifact into a private Lambda temp directory. */
export async function downloadDirectory(
  bucket: string,
  prefix: string,
  directory: string,
  s3: S3Transport = defaultS3 as unknown as S3Transport,
): Promise<string[]> {
  const root = resolve(directory);
  const normalized = prefix.replace(/\/+$/u, '') + '/';
  const keys = await listObjects(bucket, normalized, s3);
  for (const key of keys) {
    const suffix = key.slice(normalized.length);
    if (!suffix || suffix.split('/').includes('..') || suffix.startsWith('/')) throw new Error(`unsafe artifact key ${key}`);
    const destination = resolve(root, suffix);
    if (destination !== root && !destination.startsWith(`${root}/`)) throw new Error(`artifact key escapes staging root: ${key}`);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await readObject(bucket, key, s3));
  }
  return keys;
}
