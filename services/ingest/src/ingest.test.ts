import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';
import { FINGERPRINT_ALGORITHM, FINGERPRINT_BITS, DEFAULT_MATCH_OPTIONS, fingerprintFrame } from '../../../apps/extension/src/sources/screen';
import { DeckSchema } from '../../shared/jobs';
import {
  CorruptInputError,
  FormatMismatchError,
  ZeroPagesError,
  UnsupportedInputError,
  convertOfficeToPdf,
  detectInputFormat,
  ingestDeck,
  type RunCommand,
} from './ingest';

const HNSW_PDF = join(process.cwd(), 'packs/hnsw/HNSW_visualizations_slideshow.pdf');
const HNSW_PACK = join(process.cwd(), 'packs/hnsw/pack.draft.json');
const HNSW_SLIDES = join(process.cwd(), 'packs/hnsw/slides');
const DECK_FIXTURES = join(process.cwd(), 'apps/viewer/fixtures/decks');
const PPTX_FIXTURE = join(DECK_FIXTURES, 'generated-mixed-subject.pptx');

function imageDimensions(path: string): { width: number; height: number } {
  const png = PNG.sync.read(readFileSync(path));
  return { width: png.width, height: png.height };
}

function makeZipNames(names: string[]): Buffer {
  // The detector only needs the ZIP magic and central-directory names. This is
  // a deliberately tiny test double, not an input accepted by LibreOffice.
  const chunks = names.map(name => Buffer.from(name));
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), ...chunks]);
}

describe('ingest input detection', () => {
  it('detects PDF and PPTX from magic bytes, even when their names lie', () => {
    expect(detectInputFormat(readFileSync(HNSW_PDF))).toBe('pdf');
    expect(detectInputFormat(readFileSync(PPTX_FIXTURE))).toBe('pptx');

    const temp = mkdtempSync(join(tmpdir(), 'accesslens-ingest-magic-'));
    const mislabeledPptx = join(temp, 'deck.pdf');
    const mislabeledPdf = join(temp, 'deck.pptx');
    copyFileSync(PPTX_FIXTURE, mislabeledPptx);
    copyFileSync(HNSW_PDF, mislabeledPdf);
    expect(detectInputFormat(readFileSync(mislabeledPptx))).toBe('pptx');
    expect(detectInputFormat(readFileSync(mislabeledPdf))).toBe('pdf');
    expect(() => ingestDeck({ sourcePath: mislabeledPptx, jobId: 'job-mismatch', packId: 'pack', title: 'Mismatch' })).toThrow(FormatMismatchError);
    expect(() => ingestDeck({ sourcePath: mislabeledPdf, jobId: 'job-mismatch', packId: 'pack', title: 'Mismatch' })).toThrow(FormatMismatchError);
  });

  it('distinguishes DOCX for the reusable office conversion helper', () => {
    expect(detectInputFormat(makeZipNames(['[Content_Types].xml', 'word/document.xml']))).toBe('docx');
  });

  it('rejects text and unsupported/corrupt input with typed errors', () => {
    expect(() => detectInputFormat(Buffer.from('not a deck'))).toThrow(UnsupportedInputError);
    const temp = mkdtempSync(join(tmpdir(), 'accesslens-ingest-error-'));
    const corrupt = join(temp, 'corrupt.pdf');
    writeFileSync(corrupt, '%PDF-1.7\nnot a complete PDF');
    expect(() => ingestDeck({ sourcePath: corrupt, jobId: 'job-corrupt', packId: 'pack', title: 'Corrupt' })).toThrow(CorruptInputError);
  }, 30_000);
});

describe('ingest command seam', () => {
  it('uses the prototype soffice, pdftoppm, and per-page pdftotext argv exactly', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'accesslens-ingest-argv-'));
    const profileDir = join(outputDir, 'lo-profile');
    const runner = vi.fn<RunCommand>((command, args) => {
      if (command === 'soffice') {
        writeFileSync(join(outputDir, 'generated-mixed-subject.pdf'), '%PDF-1.7 fake');
      } else if (command === 'pdftoppm') {
        const png = new PNG({ width: 2, height: 2 });
        png.data.fill(0);
        writeFileSync(join(outputDir, 'page-1.png'), PNG.sync.write(png));
      } else if (command === 'pdftotext') {
        writeFileSync(args[args.length - 1], 'one page');
      }
    });

    const deck = ingestDeck({
      sourcePath: PPTX_FIXTURE,
      jobId: 'job-argv',
      packId: 'pack-argv',
      title: 'argv',
      outputDir,
      libreOfficeProfileDir: profileDir,
      runCommand: runner,
    });

    expect(deck.slides).toHaveLength(1);
    expect(runner).toHaveBeenNthCalledWith(1, 'soffice', [
      `-env:UserInstallation=file://${profileDir}`,
      '--headless', '--convert-to', 'pdf', '--outdir', outputDir, PPTX_FIXTURE,
    ]);
    expect(runner).toHaveBeenNthCalledWith(2, 'pdftoppm', [
      '-png', '-scale-to-x', '1920', '-scale-to-y', '-1',
      join(outputDir, 'generated-mixed-subject.pdf'), join(outputDir, 'page'),
    ]);
    expect(runner).toHaveBeenNthCalledWith(3, 'pdftotext', [
      '-layout', '-f', '1', '-l', '1',
      join(outputDir, 'generated-mixed-subject.pdf'), join(outputDir, 'text', 'slide-01.txt'),
    ]);
  });

  it('exports PPTX and DOCX through the same private-profile LibreOffice command', () => {
    const source = join(mkdtempSync(join(tmpdir(), 'accesslens-office-')), 'notes.docx');
    writeFileSync(source, makeZipNames(['[Content_Types].xml', 'word/document.xml']));
    const outputDir = mkdtempSync(join(tmpdir(), 'accesslens-office-out-'));
    const profileDir = join(outputDir, 'profile');
    const runner = vi.fn<RunCommand>(() => undefined);
    const pdf = convertOfficeToPdf(source, outputDir, { runCommand: runner, libreOfficeProfileDir: profileDir });
    expect(pdf).toBe(join(outputDir, 'notes.pdf'));
    expect(runner).toHaveBeenCalledWith('soffice', [
      `-env:UserInstallation=file://${profileDir}`,
      '--headless', '--convert-to', 'pdf', '--outdir', outputDir, source,
    ]);
  });

  it('reports a rendered PDF with no pages as ZeroPagesError', () => {
    const source = join(mkdtempSync(join(tmpdir(), 'accesslens-zero-')), 'empty.pdf');
    writeFileSync(source, '%PDF-1.7\n');
    const runner = vi.fn<RunCommand>(() => undefined);
    expect(() => ingestDeck({ sourcePath: source, jobId: 'job-zero', packId: 'pack', title: 'Zero', runCommand: runner })).toThrow(ZeroPagesError);
  });
});

describe('[slow] deterministic acceptance', () => {
  it('matches every checked-in HNSW fingerprint and PNG dimension', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'accesslens-ingest-hnsw-'));
    const deck = ingestDeck({
      sourcePath: HNSW_PDF,
      jobId: 'job-hnsw',
      packId: 'hnsw-explainer',
      title: 'How HNSW Works',
      outputDir,
    });
    const expectedPack = JSON.parse(readFileSync(HNSW_PACK, 'utf8')) as { assets: Array<{ assetId: string; fingerprint: string }> };
    expect(deck.slides).toHaveLength(expectedPack.assets.length);
    for (const [index, slide] of deck.slides.entries()) {
      const expected = expectedPack.assets[index];
      expect(slide.assetId).toBe(expected.assetId);
      expect(slide.fingerprint).toBe(expected.fingerprint);
      expect({ width: slide.width, height: slide.height }).toEqual(imageDimensions(join(HNSW_SLIDES, `${slide.assetId}.png`)));
      expect(readFileSync(join(outputDir, `${slide.assetId}.png`))).toEqual(readFileSync(join(HNSW_SLIDES, `${slide.assetId}.png`)));
      expect(slide.extractedText).toEqual(expect.any(String));
    }
    expect(deck.matching).toEqual({
      algorithm: FINGERPRINT_ALGORITHM,
      hashBits: FINGERPRINT_BITS,
      maxHammingDistance: DEFAULT_MATCH_OPTIONS.threshold,
      minMargin: DEFAULT_MATCH_OPTIONS.margin,
      onNoMatch: 'source.unmatched',
    });
    expect(DeckSchema.parse(deck)).toEqual(deck);
  }, 120_000);

  it('matches an independently run build-pack render for the generated PPTX', () => {
    const root = mkdtempSync(join(tmpdir(), 'accesslens-ingest-pptx-'));
    const outputDir = join(root, 'ingest');
    const referenceDir = join(root, 'reference');
    mkdirSync(outputDir);
    mkdirSync(referenceDir);
    const profileDir = join(root, 'lo-profile');
    mkdirSync(profileDir);
    const pdfName = `${basename(PPTX_FIXTURE, extname(PPTX_FIXTURE))}.pdf`;
    const pdfPath = join(referenceDir, pdfName);
    execFileSync('soffice', [
      `-env:UserInstallation=file://${profileDir}`,
      '--headless', '--convert-to', 'pdf', '--outdir', referenceDir, PPTX_FIXTURE,
    ], { stdio: 'pipe' });
    execFileSync('pdftoppm', [
      '-png', '-scale-to-x', '1920', '-scale-to-y', '-1', pdfPath, join(referenceDir, 'page'),
    ], { stdio: 'pipe' });

    const pageFiles = Array.from({ length: 20 }, (_, i) => join(referenceDir, `page-${i + 1}.png`)).filter(path => {
      try { readFileSync(path); return true; } catch { return false; }
    });
    for (const [index, pagePath] of pageFiles.entries()) {
      const assetId = `slide-${String(index + 1).padStart(2, '0')}`;
      execFileSync('pdftotext', [
        '-layout', '-f', String(index + 1), '-l', String(index + 1), pdfPath, join(referenceDir, `${assetId}.txt`),
      ], { stdio: 'pipe' });
      writeFileSync(join(referenceDir, `${assetId}.png`), readFileSync(pagePath));
    }

    const deck = ingestDeck({
      sourcePath: PPTX_FIXTURE,
      jobId: 'job-pptx',
      packId: 'mixed-subject',
      title: 'Mixed Subject Fixture',
      outputDir,
    });
    expect(deck.slides).toHaveLength(pageFiles.length);
    for (const slide of deck.slides) {
      const expectedPng = join(referenceDir, `${slide.assetId}.png`);
      const expectedPngBytes = readFileSync(expectedPng);
      expect(readFileSync(join(outputDir, `${slide.assetId}.png`))).toEqual(expectedPngBytes);
      const expected = PNG.sync.read(expectedPngBytes);
      expect(slide.fingerprint).toBe(fingerprintFrame({
        width: expected.width,
        height: expected.height,
        data: new Uint8ClampedArray(expected.data.buffer, expected.data.byteOffset, expected.data.length),
      }));
      expect(slide.extractedText).toBe(readFileSync(join(referenceDir, `${slide.assetId}.txt`), 'utf8'));
    }
  }, 120_000);
});
