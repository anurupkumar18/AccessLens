/**
 * What an uploaded file is, and which pipeline makes it accessible.
 *
 * Decided by extension, not by the Content-Type the browser guessed: browsers
 * disagree about .pptx, .mov and .m4a, and a wrong guess would send a lecture
 * recording down the document path. Pure, so the routing is testable.
 */

export type Route = 'pdf' | 'office' | 'image' | 'video' | 'audio';
export type Kind = 'document' | 'image' | 'media';

export interface Format {
  route: Route;
  kind: Kind;
  /** Browsers can play it as uploaded; otherwise the worker transcodes to MP4. */
  playable?: boolean;
  /** Needs converting before a model or a browser can read it. */
  convert?: 'heif' | 'svg' | 'magick';
}

const FORMATS: Record<string, Format> = {
  pdf: { route: 'pdf', kind: 'document' },
  ppt: { route: 'office', kind: 'document' },
  pptx: { route: 'office', kind: 'document' },
  pps: { route: 'office', kind: 'document' },
  ppsx: { route: 'office', kind: 'document' },
  odp: { route: 'office', kind: 'document' },
  key: { route: 'office', kind: 'document' },
  doc: { route: 'office', kind: 'document' },
  docx: { route: 'office', kind: 'document' },
  odt: { route: 'office', kind: 'document' },
  rtf: { route: 'office', kind: 'document' },
  xls: { route: 'office', kind: 'document' },
  xlsx: { route: 'office', kind: 'document' },
  ods: { route: 'office', kind: 'document' },

  png: { route: 'image', kind: 'image' },
  jpg: { route: 'image', kind: 'image' },
  jpeg: { route: 'image', kind: 'image' },
  gif: { route: 'image', kind: 'image' },
  webp: { route: 'image', kind: 'image' },
  bmp: { route: 'image', kind: 'image', convert: 'magick' },
  tif: { route: 'image', kind: 'image', convert: 'magick' },
  tiff: { route: 'image', kind: 'image', convert: 'magick' },
  heic: { route: 'image', kind: 'image', convert: 'heif' },
  heif: { route: 'image', kind: 'image', convert: 'heif' },
  svg: { route: 'image', kind: 'image', convert: 'svg' },

  mp4: { route: 'video', kind: 'media', playable: true },
  m4v: { route: 'video', kind: 'media', playable: true },
  webm: { route: 'video', kind: 'media', playable: true },
  mov: { route: 'video', kind: 'media', playable: false },
  mkv: { route: 'video', kind: 'media', playable: false },
  avi: { route: 'video', kind: 'media', playable: false },
  wmv: { route: 'video', kind: 'media', playable: false },
  mpg: { route: 'video', kind: 'media', playable: false },
  mpeg: { route: 'video', kind: 'media', playable: false },

  mp3: { route: 'audio', kind: 'media', playable: true },
  m4a: { route: 'audio', kind: 'media', playable: true },
  aac: { route: 'audio', kind: 'media', playable: true },
  wav: { route: 'audio', kind: 'media', playable: true },
  ogg: { route: 'audio', kind: 'media', playable: true },
  oga: { route: 'audio', kind: 'media', playable: true },
  flac: { route: 'audio', kind: 'media', playable: true },
  wma: { route: 'audio', kind: 'media', playable: false },
  aiff: { route: 'audio', kind: 'media', playable: false },
};

export const SUPPORTED_EXTENSIONS = Object.keys(FORMATS).sort();

/** Transcribe's own ceiling for a single job; documents are far smaller in practice. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

export function extensionOf(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match?.[1] ? match[1].toLowerCase() : '';
}

export function formatOf(fileName: string): Format | undefined {
  return FORMATS[extensionOf(fileName)];
}

/** A file name safe to use as the last S3 key segment, keeping the extension. */
export function safeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const cleaned = base.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').replace(/^[.-]+/, '');
  return (cleaned || 'upload').slice(-120);
}
