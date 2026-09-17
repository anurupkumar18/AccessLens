/**
 * Client for the course materials service (services/course-media). Responses
 * are validated here, so a service change surfaces as one clear error rather
 * than a blank viewer.
 */
import { z } from 'zod';
import { callService } from '../accessibility/endpoints';

const Status = z.enum(['uploading', 'processing', 'captioning', 'ready', 'failed']);

export const ItemSchema = z.object({
  itemId: z.string(),
  fileName: z.string(),
  kind: z.enum(['document', 'image', 'media']),
  status: Status,
  error: z.string().optional(),
  progress: z.object({ done: z.number(), total: z.number() }).optional(),
  createdAt: z.string(),
});
export type Item = z.infer<typeof ItemSchema>;

const Figure = z.object({ altText: z.string(), longDescription: z.string() });

export const ManifestSchema = z.object({
  version: z.literal(1),
  itemId: z.string(),
  fileName: z.string(),
  kind: z.enum(['document', 'image', 'media']),
  document: z.object({
    pages: z.array(z.object({ number: z.number(), imageKey: z.string(), description: z.string(), text: z.string(), figures: z.array(Figure) })),
    truncatedAt: z.number().optional(),
  }).optional(),
  image: z.object({ imageKey: z.string(), decorative: z.boolean(), altText: z.string(), longDescription: z.string() }).optional(),
  media: z.object({
    type: z.enum(['video', 'audio']),
    mediaKey: z.string().optional(),
    vttKey: z.string(),
    language: z.string().optional(),
    transcript: z.array(z.object({ start: z.number(), end: z.number(), text: z.string() })),
  }).optional(),
});
export type Manifest = z.infer<typeof ManifestSchema>;

const ClassListSchema = z.object({ classCode: z.string(), title: z.string(), items: z.array(ItemSchema) });
export type ClassList = z.infer<typeof ClassListSchema>;

const ItemDetailSchema = z.object({
  item: ItemSchema,
  manifest: ManifestSchema.optional(),
  urls: z.record(z.string(), z.string()).optional(),
});
export type ItemDetail = z.infer<typeof ItemDetailSchema>;

export interface InstructorClass {
  classCode: string;
  instructorKey: string;
  title: string;
}

export interface CourseMediaApi {
  createClass(title: string): Promise<InstructorClass>;
  upload(cls: InstructorClass, file: File, onProgress: (fraction: number) => void): Promise<string>;
  list(classCode: string): Promise<ClassList>;
  get(classCode: string, itemId: string): Promise<ItemDetail>;
  remove(cls: InstructorClass, itemId: string): Promise<void>;
}

/** PUT straight to S3. XHR rather than fetch: fetch cannot report upload progress. */
function putWithProgress(url: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection.'));
    xhr.send(file);
  });
}

export const courseMediaApi: CourseMediaApi = {
  async createClass(title) {
    const out = await callService<unknown>('courseMedia', { action: 'createClass', title });
    return z.object({ classCode: z.string(), instructorKey: z.string(), title: z.string() }).parse(out);
  },
  async upload(cls, file, onProgress) {
    const out = z.object({ itemId: z.string(), uploadUrl: z.string() }).parse(await callService<unknown>('courseMedia', {
      action: 'uploadUrl', classCode: cls.classCode, instructorKey: cls.instructorKey, fileName: file.name, size: file.size,
    }));
    await putWithProgress(out.uploadUrl, file, onProgress);
    return out.itemId;
  },
  async list(classCode) {
    return ClassListSchema.parse(await callService<unknown>('courseMedia', { action: 'list', classCode }));
  },
  async get(classCode, itemId) {
    return ItemDetailSchema.parse(await callService<unknown>('courseMedia', { action: 'get', classCode, itemId }));
  },
  async remove(cls, itemId) {
    await callService<unknown>('courseMedia', { action: 'delete', classCode: cls.classCode, instructorKey: cls.instructorKey, itemId });
  },
};

/** "ABCD2345" -> "ABCD-2345", the way it is read aloud in a lecture hall. */
export const displayCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

export function statusText(item: Item): string {
  switch (item.status) {
    case 'uploading': return 'Uploading…';
    case 'processing':
      return item.progress && item.progress.total > 1
        ? `Adding alt text: ${item.progress.done} of ${item.progress.total} pages done`
        : 'Adding alt text…';
    case 'captioning': return 'Adding captions…';
    case 'ready': return 'Ready for students';
    case 'failed': return item.error ?? 'Could not be processed.';
  }
}
