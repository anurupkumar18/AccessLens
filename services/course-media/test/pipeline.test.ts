import { describe, expect, it } from 'vitest';
import { fallbackPage, MAX_ALT_CHARS, pagePrompt, parseImage, parsePage } from '../src/descriptions.js';
import { formatOf, safeFileName } from '../src/formats.js';
import { keys, parseJobName, parseUploadKey, transcriptionJobName } from '../src/manifest.js';
import { updateExpression } from '../src/store.js';
import { parseVtt } from '../src/vtt.js';

describe('formatOf', () => {
  it('routes every common course format, case-insensitively', () => {
    expect(formatOf('Lecture 3.PPTX')).toMatchObject({ route: 'office', kind: 'document' });
    expect(formatOf('notes.ppt')?.route).toBe('office');
    expect(formatOf('syllabus.docx')?.route).toBe('office');
    expect(formatOf('reading.pdf')?.route).toBe('pdf');
    expect(formatOf('IMG_0042.HEIC')).toMatchObject({ route: 'image', convert: 'heif' });
    expect(formatOf('diagram.svg')).toMatchObject({ route: 'image', convert: 'svg' });
    expect(formatOf('lab.mov')).toMatchObject({ route: 'video', playable: false });
    expect(formatOf('week2.mp4')).toMatchObject({ route: 'video', playable: true });
    expect(formatOf('podcast.m4a')).toMatchObject({ route: 'audio', playable: true });
    expect(formatOf('archive.zip')).toBeUndefined();
    expect(formatOf('no-extension')).toBeUndefined();
  });

  it('makes S3-safe file names that keep the extension', () => {
    expect(safeFileName('../../Week 3: Cells (final).pptx')).toBe('Week-3-Cells-final.pptx');
    expect(safeFileName('..')).toBe('upload');
    expect(formatOf(safeFileName('Café lecture.MOV'))?.route).toBe('video');
  });
});

describe('keys', () => {
  it('round-trips upload keys and transcription job names', () => {
    const key = keys.upload('ABCD2345', '0123456789abcdef', 'Week-3.pptx');
    expect(parseUploadKey(key)).toEqual({ classCode: 'ABCD2345', itemId: '0123456789abcdef', fileName: 'Week-3.pptx' });
    expect(parseUploadKey('derived/ABCD2345/0123456789abcdef/manifest.json')).toBeUndefined();
    expect(parseJobName(transcriptionJobName('ABCD2345', '0123456789abcdef'))).toEqual({ classCode: 'ABCD2345', itemId: '0123456789abcdef' });
    expect(parseJobName('someone-elses-job')).toBeUndefined();
  });
});

describe('descriptions', () => {
  it('accepts a page and drops figures with no alt text', () => {
    const page = parsePage({
      description: 'Slide on the Krebs cycle with a circular diagram.',
      figures: [{ altText: 'Krebs cycle diagram', longDescription: 'Eight steps...' }, { altText: '  ', longDescription: 'x' }],
    });
    expect(page?.figures).toEqual([{ altText: 'Krebs cycle diagram', longDescription: 'Eight steps...' }]);
  });

  it('refuses a page with no description, so the fallback is used instead of silence', () => {
    expect(parsePage({ description: '', figures: [] })).toBeUndefined();
    expect(fallbackPage('Some text').description).toContain('could not be generated');
  });

  it('bounds alt text and blanks decorative images', () => {
    expect(parseImage({ decorative: false, altText: 'x'.repeat(900), longDescription: '' })!.altText.length).toBeLessThanOrEqual(MAX_ALT_CHARS);
    expect(parseImage({ decorative: true, altText: 'border', longDescription: '' })).toEqual({ decorative: true, altText: '', longDescription: '' });
    expect(parseImage({ decorative: false, altText: '' })).toBeUndefined();
  });

  it('gives the model the exact page text, or says there is none', () => {
    expect(pagePrompt('deck.pptx', 2, 10, 'Mitochondria')).toContain('Mitochondria');
    expect(pagePrompt('scan.pdf', 1, 1, '')).toContain('no extractable text');
  });
});

describe('parseVtt', () => {
  it('reads Transcribe subtitles into cues, past an hour and with tags stripped', () => {
    const cues = parseVtt('WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.500\nToday we look at\ncells.\n\n2\n01:02:03.400 --> 01:02:05.000 align:start\n<v Speaker>Next part</v>\n\nbroken block\n');
    expect(cues).toEqual([
      { start: 0, end: 2.5, text: 'Today we look at cells.' },
      { start: 3723.4, end: 3725, text: 'Next part' },
    ]);
  });
});

describe('updateExpression', () => {
  it('turns undefined into REMOVE instead of a dangling value reference', () => {
    const { expression, names, values } = updateExpression({ status: 'ready', error: undefined });
    expect(expression).toBe('SET #k0 = :v0 REMOVE #k1');
    expect(names).toEqual({ '#k0': 'status', '#k1': 'error' });
    expect(values).toEqual({ ':v0': 'ready' });
  });
});
