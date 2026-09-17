/**
 * Function URL the extension calls. Professors create a class and upload;
 * students list a class and open items. Processing happens elsewhere (the
 * worker) the moment an upload lands, so nothing here waits on a model.
 *
 *   { action: 'createClass', title }                               -> { classCode, instructorKey, title }
 *   { action: 'uploadUrl', classCode, instructorKey, fileName, size } -> { itemId, uploadUrl }
 *   { action: 'list', classCode }                                   -> { title, items }
 *   { action: 'get', classCode, itemId }                            -> { item, manifest?, urls }
 *   { action: 'delete', classCode, instructorKey, itemId }           -> { deleted: true }
 *
 * The class code is what students hold; the instructor key never leaves the
 * professor's extension and is stored here only as a hash.
 */
import { timingSafeEqual } from 'node:crypto';
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { formatOf, MAX_UPLOAD_BYTES, safeFileName, SUPPORTED_EXTENSIONS } from './formats.js';
import { keys, type Manifest } from './manifest.js';
import {
  BUCKET, deleteItemRecord, expiry, getClass, getItem, hashKey, listItems, newClassCode, newInstructorKey, newItemId,
  putClass, putItem, readText, s3, type ItemRecord,
} from './store.js';

interface FunctionUrlEvent {
  requestContext?: { http?: { method?: string } };
  body?: string | null;
  isBase64Encoded?: boolean;
}

const UPLOAD_URL_SECONDS = 3600;
/** Long enough to watch a full lecture without the video URL expiring mid-way. */
const VIEW_URL_SECONDS = 6 * 3600;

const json = (statusCode: number, payload: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});
const fail = (statusCode: number, error: string) => json(statusCode, { error });

const CODE = /^[A-Z0-9]{8}$/;
const ITEM = /^[a-z0-9]{12,32}$/;

function normaliseCode(value: unknown): string | undefined {
  const code = typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : '';
  return CODE.test(code) ? code : undefined;
}

async function authorise(classCode: string, instructorKey: unknown): Promise<boolean> {
  if (typeof instructorKey !== 'string' || !instructorKey) return false;
  const record = await getClass(classCode);
  if (!record) return false;
  const given = Buffer.from(hashKey(instructorKey));
  const stored = Buffer.from(record.keyHash);
  return given.length === stored.length && timingSafeEqual(given, stored);
}

const publicItem = (item: ItemRecord) => ({
  itemId: item.itemId,
  fileName: item.fileName,
  kind: item.kind,
  status: item.status,
  error: item.error,
  progress: item.progress,
  createdAt: item.createdAt,
});

/**
 * Uploads arrive without a Content-Type and Transcribe writes captions as
 * binary/octet-stream. Chrome sniffs past that; other browsers refuse a
 * caption track that is not text/vtt. So the type is set on the signed URL.
 */
const CONTENT_TYPES: Record<string, string> = {
  vtt: 'text/vtt', jpg: 'image/jpeg', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac',
};

export function contentTypeFor(key: string): string | undefined {
  return CONTENT_TYPES[key.split('.').pop()?.toLowerCase() ?? ''];
}

const sign = (key: string) => getSignedUrl(
  s3,
  new GetObjectCommand({ Bucket: BUCKET, Key: key, ResponseContentType: contentTypeFor(key) }),
  { expiresIn: VIEW_URL_SECONDS },
);

async function signManifest(manifest: Manifest): Promise<Record<string, string>> {
  const wanted = new Set<string>();
  manifest.document?.pages.forEach(page => wanted.add(page.imageKey));
  if (manifest.image) wanted.add(manifest.image.imageKey);
  if (manifest.media?.mediaKey) wanted.add(manifest.media.mediaKey);
  if (manifest.media?.vttKey) wanted.add(manifest.media.vttKey);
  const urls: Record<string, string> = {};
  await Promise.all([...wanted].map(async key => { urls[key] = await sign(key); }));
  return urls;
}

export async function handler(event: FunctionUrlEvent) {
  try {
    if (event.requestContext?.http?.method === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' };
    let body: Record<string, unknown>;
    try {
      const raw = event.isBase64Encoded && event.body ? Buffer.from(event.body, 'base64').toString('utf8') : event.body ?? '';
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
      body = parsed as Record<string, unknown>;
    } catch {
      return fail(400, 'Request body must be a JSON object.');
    }

    switch (body['action']) {
      case 'createClass': {
        const title = typeof body['title'] === 'string' ? body['title'].trim().slice(0, 120) : '';
        const instructorKey = newInstructorKey();
        for (let attempt = 0; attempt < 5; attempt++) {
          const classCode = newClassCode();
          const created = await putClass({
            classCode, sk: 'CLASS', title: title || 'My class', keyHash: hashKey(instructorKey),
            createdAt: new Date().toISOString(), expiresAt: expiry(),
          });
          if (created) return json(200, { classCode, instructorKey, title: title || 'My class' });
        }
        return fail(503, 'Could not create a class. Try again.');
      }

      case 'uploadUrl': {
        const classCode = normaliseCode(body['classCode']);
        if (!classCode || !(await authorise(classCode, body['instructorKey']))) return fail(403, 'This class code and key do not match.');
        const fileName = typeof body['fileName'] === 'string' ? body['fileName'] : '';
        const format = formatOf(fileName);
        if (!format) {
          return fail(400, `"${fileName}" is not a supported file type. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}.`);
        }
        const size = typeof body['size'] === 'number' ? body['size'] : -1;
        if (size <= 0 || size > MAX_UPLOAD_BYTES) return fail(400, 'Files must be larger than 0 bytes and at most 2 GB.');

        const itemId = newItemId();
        const safeName = safeFileName(fileName);
        const now = new Date().toISOString();
        await putItem({
          classCode, itemId, fileName: fileName.slice(0, 200), kind: format.kind, status: 'uploading',
          sizeBytes: size, createdAt: now, updatedAt: now, expiresAt: expiry(),
        });
        const uploadUrl = await getSignedUrl(
          s3,
          new PutObjectCommand({ Bucket: BUCKET, Key: keys.upload(classCode, itemId, safeName) }),
          { expiresIn: UPLOAD_URL_SECONDS },
        );
        return json(200, { itemId, uploadUrl });
      }

      case 'list': {
        const classCode = normaliseCode(body['classCode']);
        const record = classCode ? await getClass(classCode) : undefined;
        if (!classCode || !record) return fail(404, 'No class has this code. Check it with your professor.');
        const items = await listItems(classCode);
        return json(200, { classCode, title: record.title, items: items.map(publicItem) });
      }

      case 'get': {
        const classCode = normaliseCode(body['classCode']);
        const itemId = typeof body['itemId'] === 'string' && ITEM.test(body['itemId']) ? body['itemId'] : undefined;
        const item = classCode && itemId ? await getItem(classCode, itemId) : undefined;
        if (!classCode || !itemId || !item) return fail(404, 'This material is no longer available.');
        if (item.status !== 'ready') return json(200, { item: publicItem(item) });
        const manifest = JSON.parse(await readText(keys.manifest(classCode, itemId))) as Manifest;
        return json(200, { item: publicItem(item), manifest, urls: await signManifest(manifest) });
      }

      case 'delete': {
        const classCode = normaliseCode(body['classCode']);
        const itemId = typeof body['itemId'] === 'string' && ITEM.test(body['itemId']) ? body['itemId'] : undefined;
        if (!classCode || !itemId || !(await authorise(classCode, body['instructorKey']))) return fail(403, 'This class code and key do not match.');
        await deleteItemRecord(classCode, itemId);
        for (const prefix of [`uploads/${classCode}/${itemId}/`, `${keys.derived(classCode, itemId)}/`]) {
          let token: string | undefined;
          do {
            const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }));
            const objects = (listed.Contents ?? []).map(o => ({ Key: o.Key! }));
            if (objects.length) await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: objects } }));
            token = listed.NextContinuationToken;
          } while (token);
        }
        return json(200, { deleted: true });
      }

      default:
        return fail(400, 'Unknown action.');
    }
  } catch (error) {
    console.log(JSON.stringify({ event: 'course-media-api-failed', reason: (error as Error)?.name ?? 'unknown' }));
    return fail(502, 'The course materials service is temporarily unavailable.');
  }
}
