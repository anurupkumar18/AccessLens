import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';
import {
  DEFAULT_MATCH_OPTIONS,
  FINGERPRINT_ALGORITHM,
  FINGERPRINT_BITS,
  fingerprintFrame,
} from '../../../apps/extension/src/sources/screen';
import { DeckSchema, type Deck } from '../../shared/jobs';

export type InputFormat = 'pdf' | 'pptx' | 'docx';

/** Errors that the job runner can turn into a failed job without parsing strings. */
export class IngestError extends Error {
  readonly code: 'unsupported_input' | 'corrupt_input' | 'zero_pages';

  constructor(code: IngestError['code'], message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class UnsupportedInputError extends IngestError {
  constructor(message: string) {
    super('unsupported_input', message);
  }
}

export class CorruptInputError extends IngestError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('corrupt_input', message);
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

export class FormatMismatchError extends UnsupportedInputError {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ZeroPagesError extends IngestError {
  constructor(message = 'The input rendered zero pages') {
    super('zero_pages', message);
  }
}

/** The only subprocess seam in this module. Tests can assert argv without a shell. */
export type RunCommand = (command: string, args: string[]) => void;

export const runCommand: RunCommand = (command, args) => {
  execFileSync(command, args, { stdio: 'inherit' });
};

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function isZip(bytes: Uint8Array): boolean {
  return hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04])
    || hasPrefix(bytes, [0x50, 0x4b, 0x05, 0x06])
    || hasPrefix(bytes, [0x50, 0x4b, 0x07, 0x08]);
}

/**
 * Detects the supported office formats from their signatures, never from a
 * filename extension. ZIP entry names are present in both local headers and
 * the central directory, so inspecting the bytes avoids another dependency.
 */
export function detectInputFormat(bytes: Uint8Array): InputFormat {
  if (hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';
  if (!isZip(bytes)) {
    throw new UnsupportedInputError('Unsupported input: expected a PDF, PPTX, or DOCX magic signature');
  }

  const names = Buffer.from(bytes).toString('latin1');
  if (names.includes('ppt/presentation.xml')) return 'pptx';
  if (names.includes('word/document.xml')) return 'docx';
  throw new UnsupportedInputError('Unsupported ZIP input: expected a PPTX or DOCX package');
}

function defaultProfileDir(outputDir: string): string {
  return join(outputDir, 'lo-profile');
}

function assertExtensionMatches(sourcePath: string, format: InputFormat): void {
  const extension = extname(sourcePath).toLowerCase();
  const expected = format === 'pdf' ? '.pdf' : format === 'pptx' ? '.pptx' : '.docx';
  if (extension && ['.pdf', '.pptx', '.docx'].includes(extension) && extension !== expected) {
    throw new FormatMismatchError(`Input ${sourcePath} has ${extension} extension but magic bytes identify ${format.toUpperCase()}; rename it or upload the correct file`);
  }
}

export interface CommandOptions {
  runCommand?: RunCommand;
  libreOfficeProfileDir?: string;
}

/**
 * Converts a PPTX or DOCX to PDF with the same private-profile invocation as
 * scripts/build-pack.ts. This is exported for the course-library indexer too.
 */
export function convertOfficeToPdf(
  sourcePath: string,
  outputDir: string,
  options: CommandOptions = {},
): string {
  const source = resolve(sourcePath);
  const bytes = readFileSync(source);
  const format = detectInputFormat(bytes);
  if (format !== 'pptx' && format !== 'docx') {
    throw new UnsupportedInputError(`LibreOffice conversion accepts PPTX or DOCX, not ${format}`);
  }
  assertExtensionMatches(source, format);

  const out = resolve(outputDir);
  mkdirSync(out, { recursive: true });
  const profile = resolve(options.libreOfficeProfileDir ?? defaultProfileDir(out));
  mkdirSync(profile, { recursive: true });
  const command = options.runCommand ?? runCommand;
  command('soffice', [
    `-env:UserInstallation=file://${profile}`,
    '--headless', '--convert-to', 'pdf', '--outdir', out, source,
  ]);
  return join(out, `${basename(source, extname(source))}.pdf`);
}

export interface IngestDeckOptions extends CommandOptions {
  sourcePath: string;
  jobId: string;
  packId: string;
  title: string;
  /** S3 key or other stable source identifier. Defaults to sourcePath. */
  sourceKey?: string;
  /** A caller-owned directory in which rendered slide files are left. */
  outputDir?: string;
  /** Prefix used for DeckSlide.mediaKey. Defaults to the job's staging media path. */
  mediaKeyPrefix?: string;
}

function cleanupRenderFiles(outputDir: string): void {
  mkdirSync(outputDir, { recursive: true });
  for (const name of readdirSync(outputDir)) {
    if (/^page-\d+\.png$/.test(name) || /^slide-\d+\.png$/.test(name)) {
      rmSync(join(outputDir, name), { force: true });
    }
  }
  rmSync(join(outputDir, 'text'), { recursive: true, force: true });
  mkdirSync(join(outputDir, 'text'), { recursive: true });
}

function commandFailure(command: string, sourcePath: string, cause: unknown): CorruptInputError {
  const detail = cause instanceof Error && cause.message ? `: ${cause.message}` : '';
  return new CorruptInputError(`Could not process ${sourcePath} with ${command}${detail}`, { cause });
}

function renderedPages(outputDir: string): string[] {
  return readdirSync(outputDir)
    .filter(name => /^page-\d+\.png$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0));
}

function runOrThrow(command: string, args: string[], sourcePath: string, runner: RunCommand): void {
  try {
    runner(command, args);
  } catch (error) {
    throw commandFailure(command, sourcePath, error);
  }
}

/**
 * Deterministically turns a PDF or PPTX into the job-internal Deck shape.
 * There is deliberately no model or network call in this function.
 */
export function ingestDeck(options: IngestDeckOptions): Deck {
  const sourcePath = resolve(options.sourcePath);
  if (!existsSync(sourcePath)) {
    throw new CorruptInputError(`Input file does not exist: ${sourcePath}`);
  }

  let format: InputFormat;
  try {
    format = detectInputFormat(readFileSync(sourcePath));
  } catch (error) {
    if (error instanceof IngestError) throw error;
    throw new CorruptInputError(`Could not read input ${sourcePath}`, { cause: error });
  }
  assertExtensionMatches(sourcePath, format);
  if (format === 'docx') {
    throw new UnsupportedInputError('DOCX is supported by convertOfficeToPdf for library indexing, not as a slide deck');
  }

  const outputDir = resolve(options.outputDir ?? mkdtempSync(join(tmpdir(), `accesslens-ingest-${options.jobId}-`)));
  cleanupRenderFiles(outputDir);
  const runner = options.runCommand ?? runCommand;
  const profile = options.libreOfficeProfileDir ?? defaultProfileDir(outputDir);
  let pdfPath = sourcePath;
  if (format === 'pptx') {
    try {
      pdfPath = convertOfficeToPdf(sourcePath, outputDir, {
        runCommand: runner,
        libreOfficeProfileDir: profile,
      });
    } catch (error) {
      if (error instanceof IngestError) throw error;
      throw commandFailure('soffice', sourcePath, error);
    }
    if (!existsSync(pdfPath)) {
      throw new CorruptInputError(`LibreOffice did not produce the expected PDF: ${pdfPath}`);
    }
  }

  runOrThrow('pdftoppm', [
    '-png', '-scale-to-x', '1920', '-scale-to-y', '-1', pdfPath, join(outputDir, 'page'),
  ], sourcePath, runner);
  const pages = renderedPages(outputDir);
  if (pages.length === 0) throw new ZeroPagesError(`No pages were rendered from ${sourcePath}`);

  const mediaKeyPrefix = (options.mediaKeyPrefix ?? `staging/${options.jobId}/media`).replace(/\/$/, '');
  const textDir = join(outputDir, 'text');
  const slides: Deck['slides'] = [];
  for (const [index, pageFile] of pages.entries()) {
    const page = index + 1;
    const assetId = `slide-${String(page).padStart(2, '0')}`;
    const pagePath = join(outputDir, pageFile);
    const slidePath = join(outputDir, `${assetId}.png`);
    renameSync(pagePath, slidePath);
    const textPath = join(textDir, `${assetId}.txt`);
    runOrThrow('pdftotext', [
      '-layout', '-f', String(page), '-l', String(page), pdfPath, textPath,
    ], sourcePath, runner);
    if (!existsSync(textPath)) {
      throw new CorruptInputError(`pdftotext did not produce ${textPath}`);
    }

    let png: PNG;
    try {
      png = PNG.sync.read(readFileSync(slidePath));
    } catch (error) {
      throw new CorruptInputError(`Rendered page ${page} is not a valid PNG`, { cause: error });
    }
    const fingerprint = fingerprintFrame({
      width: png.width,
      height: png.height,
      data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length),
    });
    slides.push({
      assetId,
      page,
      mediaKey: `${mediaKeyPrefix}/${assetId}.png`,
      width: png.width,
      height: png.height,
      fingerprint,
      extractedText: readFileSync(textPath, 'utf8'),
    });
  }

  if (format === 'pptx') rmSync(pdfPath, { force: true });
  const deck = {
    jobId: options.jobId,
    packId: options.packId,
    title: options.title,
    sourceKey: options.sourceKey ?? options.sourcePath,
    sourceFormat: format,
    matching: {
      algorithm: FINGERPRINT_ALGORITHM,
      hashBits: FINGERPRINT_BITS,
      maxHammingDistance: DEFAULT_MATCH_OPTIONS.threshold,
      minMargin: DEFAULT_MATCH_OPTIONS.margin,
      onNoMatch: 'source.unmatched' as const,
    },
    slides,
  };
  return DeckSchema.parse(deck);
}
