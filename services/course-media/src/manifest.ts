/**
 * What students receive for one uploaded item, and where it lives.
 *
 * The manifest stores S3 keys, never URLs: URLs are presigned per request by
 * the API, so a manifest written today still works next week, and nothing in
 * the bucket is ever public.
 */
import type { Kind } from './formats.js';

export type ItemStatus = 'uploading' | 'processing' | 'captioning' | 'ready' | 'failed';

export interface Figure {
  altText: string;
  longDescription: string;
}

export interface Page {
  number: number;
  imageKey: string;
  /** Alt text for the page as a whole. */
  description: string;
  /** The page's own text, extracted exactly rather than generated. */
  text: string;
  figures: Figure[];
}

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export interface Manifest {
  version: 1;
  itemId: string;
  fileName: string;
  kind: Kind;
  document?: { pages: Page[]; truncatedAt?: number };
  image?: { imageKey: string; decorative: boolean; altText: string; longDescription: string };
  media?: {
    type: 'video' | 'audio';
    /** Absent when the file could not be made playable; captions still exist. */
    mediaKey?: string;
    vttKey: string;
    language?: string;
    transcript: Cue[];
  };
}

export const keys = {
  upload: (classCode: string, itemId: string, fileName: string) => `uploads/${classCode}/${itemId}/${fileName}`,
  derived: (classCode: string, itemId: string) => `derived/${classCode}/${itemId}`,
  manifest: (classCode: string, itemId: string) => `derived/${classCode}/${itemId}/manifest.json`,
};

/** `uploads/<class>/<item>/<name>` -> its parts, or undefined for anything else. */
export function parseUploadKey(key: string): { classCode: string; itemId: string; fileName: string } | undefined {
  const [, classCode, itemId, fileName] = /^uploads\/([A-Z0-9]{8})\/([a-z0-9]{12,32})\/([^/]+)$/.exec(key) ?? [];
  return classCode && itemId && fileName ? { classCode, itemId, fileName } : undefined;
}

/** Transcribe job names carry the item, so the completion event can find it. */
export const transcriptionJobName = (classCode: string, itemId: string) => `accesslens-${classCode}-${itemId}`;

export function parseJobName(name: string): { classCode: string; itemId: string } | undefined {
  const [, classCode, itemId] = /^accesslens-([A-Z0-9]{8})-([a-z0-9]{12,32})$/.exec(name) ?? [];
  return classCode && itemId ? { classCode, itemId } : undefined;
}
