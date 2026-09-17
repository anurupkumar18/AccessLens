/**
 * Runs the moment an upload lands in S3. No person is in the loop: documents
 * and images come out with alt text, recordings go to Transcribe and come out
 * with captions (finished by `finish.ts` when the job completes).
 *
 * Runs in the container image built by CodeBuild (worker/Dockerfile), because
 * converting Office files and video needs LibreOffice and ffmpeg.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { StartTranscriptionJobCommand, TranscribeClient } from '@aws-sdk/client-transcribe';
import { describeWithTool, mapLimit } from './bedrock.js';
import { extractAudio, makePlayable, normaliseImage, officeToPdf, pageText, pdfPageCount, renderPages } from './convert.js';
import {
  fallbackPage, IMAGE_SYSTEM, IMAGE_TOOL, imagePrompt, PAGE_SYSTEM, PAGE_TOOL, pagePrompt, parseImage, parsePage,
} from './descriptions.js';
import { formatOf } from './formats.js';
import { keys, parseUploadKey, transcriptionJobName, type Manifest, type Page } from './manifest.js';
import { BUCKET, getClass, getItem, putManifest, s3, updateItem } from './store.js';

/** Past this, a document is cut and students are told where it stops. */
export const MAX_PAGES = 400;
const PAGE_CONCURRENCY = 6;
const transcribe = new TranscribeClient({});

interface S3Event {
  Records?: { s3?: { object?: { key?: string } } }[];
}
interface LambdaContext {
  getRemainingTimeInMillis(): number;
}

async function download(key: string, path: string): Promise<void> {
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  await pipeline(out.Body as Readable, createWriteStream(path));
}

async function upload(key: string, path: string, contentType: string): Promise<void> {
  const { size } = await stat(path);
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: createReadStream(path), ContentLength: size, ContentType: contentType }));
}

async function processDocument(classCode: string, itemId: string, fileName: string, input: string, office: boolean, work: string): Promise<Manifest> {
  const pdf = office ? await officeToPdf(input, join(work, 'pdf')) : input;
  const total = await pdfPageCount(pdf);
  const count = Math.min(total, MAX_PAGES);
  const images = await renderPages(pdf, count, join(work, 'pages'));
  await updateItem(classCode, itemId, { progress: { done: 0, total: images.length } });

  const base = keys.derived(classCode, itemId);
  let done = 0;
  const pages = await mapLimit(images, PAGE_CONCURRENCY, async (image, index): Promise<Page> => {
    const number = index + 1;
    const imageKey = `${base}/pages/${String(number).padStart(4, '0')}.jpg`;
    const [text, jpeg] = await Promise.all([pageText(pdf, number), readFile(image)]);
    await upload(imageKey, image, 'image/jpeg');
    let described: ReturnType<typeof parsePage>;
    try {
      described = parsePage(await describeWithTool(PAGE_SYSTEM, PAGE_TOOL, jpeg, pagePrompt(fileName, number, total, text)));
    } catch (error) {
      console.log(JSON.stringify({ event: 'page-description-failed', classCode, itemId, page: number, reason: (error as Error).name }));
    }
    done += 1;
    if (done % 5 === 0 || done === images.length) await updateItem(classCode, itemId, { progress: { done, total: images.length } });
    return { number, imageKey, text, ...(described ?? fallbackPage(text)) };
  });

  return {
    version: 1, itemId, fileName, kind: 'document',
    document: { pages, ...(total > count ? { truncatedAt: count } : {}) },
  };
}

async function processImage(classCode: string, itemId: string, fileName: string, input: string, convert: 'heif' | 'svg' | 'magick' | undefined, work: string): Promise<Manifest> {
  const output = join(work, 'image.jpg');
  await normaliseImage(input, output, convert);
  const imageKey = `${keys.derived(classCode, itemId)}/image.jpg`;
  await upload(imageKey, output, 'image/jpeg');
  const record = await getClass(classCode);
  const description = parseImage(await describeWithTool(IMAGE_SYSTEM, IMAGE_TOOL, await readFile(output), imagePrompt(fileName, record?.title ?? '')));
  return {
    version: 1, itemId, fileName, kind: 'image',
    image: { imageKey, ...(description ?? { decorative: false, altText: 'A description of this image could not be generated.', longDescription: '' }) },
  };
}

async function startCaptions(classCode: string, itemId: string, uploadKey: string, input: string, video: boolean, playable: boolean, work: string, context: LambdaContext): Promise<void> {
  const base = keys.derived(classCode, itemId);
  const audio = join(work, 'audio.flac');
  await extractAudio(input, audio);
  await upload(`${base}/audio.flac`, audio, 'audio/flac');

  // Players need something they can play; captions do not wait on it.
  let mediaKey: string | undefined = uploadKey;
  if (!playable) {
    const mp4 = join(work, 'playable.mp4');
    const deadline = Math.max(30_000, context.getRemainingTimeInMillis() - 90_000);
    if (video && (await makePlayable(input, mp4, deadline))) {
      mediaKey = `${base}/playable.mp4`;
      await upload(mediaKey, mp4, 'video/mp4');
    } else if (!video) {
      mediaKey = `${base}/audio.flac`;
    } else {
      mediaKey = undefined;
    }
  }
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: `${base}/media.json`, ContentType: 'application/json',
    Body: JSON.stringify({ type: video ? 'video' : 'audio', mediaKey }),
  }));

  await transcribe.send(new StartTranscriptionJobCommand({
    TranscriptionJobName: transcriptionJobName(classCode, itemId),
    Media: { MediaFileUri: `s3://${BUCKET}/${base}/audio.flac` },
    MediaFormat: 'flac',
    // No language picker for the professor: Transcribe works it out.
    IdentifyLanguage: true,
    OutputBucketName: BUCKET,
    OutputKey: `${base}/transcribe/`,
    Subtitles: { Formats: ['vtt'], OutputStartIndex: 1 },
  }));
}

export async function handler(event: S3Event, context: LambdaContext): Promise<void> {
  for (const record of event.Records ?? []) {
    const key = decodeURIComponent((record.s3?.object?.key ?? '').replace(/\+/g, ' '));
    const parts = parseUploadKey(key);
    if (!parts) continue;
    const { classCode, itemId } = parts;
    const item = await getItem(classCode, itemId);
    if (!item) continue;
    const format = formatOf(item.fileName);
    const work = join('/tmp', itemId);

    try {
      if (!format) throw new Error('Unsupported file type.');
      await updateItem(classCode, itemId, { status: format.kind === 'media' ? 'captioning' : 'processing', error: undefined });
      await mkdir(work, { recursive: true });
      const input = join(work, `input.${key.split('.').pop()}`);
      await download(key, input);

      if (format.route === 'video' || format.route === 'audio') {
        await startCaptions(classCode, itemId, key, input, format.route === 'video', format.playable === true, work, context);
        continue;
      }
      const manifest = format.route === 'image'
        ? await processImage(classCode, itemId, item.fileName, input, format.convert, work)
        : await processDocument(classCode, itemId, item.fileName, input, format.route === 'office', work);
      await putManifest(keys.manifest(classCode, itemId), manifest);
      await updateItem(classCode, itemId, { status: 'ready', progress: undefined });
    } catch (error) {
      console.log(JSON.stringify({ event: 'course-media-failed', classCode, itemId, route: format?.route, reason: (error as Error).name, message: (error as Error).message?.slice(0, 200) }));
      await updateItem(classCode, itemId, {
        status: 'failed',
        error: format?.route === 'office'
          ? 'This file could not be converted. If it opens in PowerPoint or Word, export it as PDF and upload that.'
          : 'This file could not be processed. It may be damaged or protected; try exporting it again.',
      });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
}
