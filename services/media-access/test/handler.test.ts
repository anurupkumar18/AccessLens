import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_ALT_CHARS, parseDraft, userPrompt } from '../src/altText.js';
import { toTimedWords } from '../src/words.js';

const requestAltText = vi.hoisted(() => vi.fn());
const transcribeWithTimings = vi.hoisted(() => vi.fn());
vi.mock('../src/aws.js', () => ({ requestAltText, transcribeWithTimings, SAMPLE_RATE_HZ: 16000 }));

import { handler, MAX_AUDIO_BYTES } from '../src/handler.js';

const post = (body: unknown, method = 'POST') =>
  handler({ requestContext: { http: { method } }, body: typeof body === 'string' ? body : JSON.stringify(body) });

const parse = async (result: Promise<{ statusCode: number; body: string }>) => {
  const settled = await result;
  return { status: settled.statusCode, body: JSON.parse(settled.body || '{}') as Record<string, unknown> };
};

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64');

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('parseDraft', () => {
  it('refuses a non-decorative draft with no alt text, since empty alt hides the image', () => {
    expect(parseDraft({ decorative: false, altText: '   ', longDescription: '' })).toBeUndefined();
  });

  it('blanks both fields when the model calls an image decorative', () => {
    expect(parseDraft({ decorative: true, altText: 'a border', longDescription: 'x' }))
      .toEqual({ decorative: true, altText: '', longDescription: '' });
  });

  it('flattens whitespace and clips overlong alt text', () => {
    const draft = parseDraft({ decorative: false, altText: `A\n\nbar chart ${'x'.repeat(400)}`, longDescription: ' Axes. ' });
    expect(draft?.altText.startsWith('A bar chart')).toBe(true);
    expect(draft?.altText.length).toBeLessThanOrEqual(MAX_ALT_CHARS);
    expect(draft?.longDescription).toBe('Axes.');
  });

  it('refuses input that is not a tool call shape', () => {
    expect(parseDraft(undefined)).toBeUndefined();
    expect(parseDraft({ altText: 'no decorative flag' })).toBeUndefined();
  });
});

describe('userPrompt', () => {
  it('says when no surrounding content was provided rather than inventing some', () => {
    expect(userPrompt('  ')).toContain('No surrounding content');
    expect(userPrompt('Slide 3: Krebs cycle')).toContain('Krebs cycle');
  });
});

describe('toTimedWords', () => {
  it('keeps final results only and attaches punctuation to the word before it', () => {
    const words = toTimedWords([
      { IsPartial: true, Alternatives: [{ Items: [{ Content: 'Cells', Type: 'pronunciation', StartTime: 0, EndTime: 0.4 }] }] },
      {
        IsPartial: false,
        Alternatives: [{
          Items: [
            { Content: 'Cells', Type: 'pronunciation', StartTime: 0.01, EndTime: 0.4 },
            { Content: 'divide', Type: 'pronunciation', StartTime: 0.45, EndTime: 0.9 },
            { Content: '.', Type: 'punctuation' },
          ],
        }],
      },
    ]);
    expect(words).toEqual([
      { text: 'Cells', start: 0.01, end: 0.4 },
      { text: 'divide.', start: 0.45, end: 0.9 },
    ]);
  });

  it('drops untimed words instead of guessing where they belong', () => {
    expect(toTimedWords([{ Alternatives: [{ Items: [{ Content: 'um', Type: 'pronunciation' }] }] }])).toEqual([]);
  });
});

describe('handler', () => {
  it('returns a draft for an image', async () => {
    requestAltText.mockResolvedValue({ decorative: false, altText: 'Mitochondrion cross-section with cristae labelled.', longDescription: '' });
    const { status, body } = await parse(post({ kind: 'alt-text', image: png, mediaType: 'image/png', context: 'Slide 2' }));
    expect(status).toBe(200);
    expect(body['draft']).toMatchObject({ decorative: false });
    expect(requestAltText).toHaveBeenCalledWith(expect.any(Uint8Array), 'png', 'Slide 2');
  });

  it('refuses unsupported image types before calling the model', async () => {
    const { status } = await parse(post({ kind: 'alt-text', image: png, mediaType: 'image/x-emf' }));
    expect(status).toBe(400);
    expect(requestAltText).not.toHaveBeenCalled();
  });

  it('turns an unusable model reply into a 502 the instructor can act on', async () => {
    requestAltText.mockResolvedValue({ decorative: false, altText: '' });
    const { status, body } = await parse(post({ kind: 'alt-text', image: png, mediaType: 'image/png' }));
    expect(status).toBe(502);
    expect(String(body['error'])).toContain('by hand');
  });

  it('returns timed words for audio', async () => {
    transcribeWithTimings.mockResolvedValue([
      { IsPartial: false, Alternatives: [{ Items: [{ Content: 'Hello', Type: 'pronunciation', StartTime: 0.1, EndTime: 0.5 }] }] },
    ]);
    const audio = Buffer.alloc(3200).toString('base64');
    const { status, body } = await parse(post({ kind: 'transcribe', audio, lang: 'es-US' }));
    expect(status).toBe(200);
    expect(body['words']).toEqual([{ text: 'Hello', start: 0.1, end: 0.5 }]);
    expect(transcribeWithTimings).toHaveBeenCalledWith(expect.any(Uint8Array), 'es-US');
  });

  it('refuses oversized audio without decoding it', async () => {
    const audio = 'A'.repeat(Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 4096);
    const { status } = await parse(post({ kind: 'transcribe', audio }));
    expect(status).toBe(400);
    expect(transcribeWithTimings).not.toHaveBeenCalled();
  });

  it('never logs media content', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    requestAltText.mockResolvedValue({ decorative: false, altText: 'SECRET-DESCRIPTION', longDescription: '' });
    await post({ kind: 'alt-text', image: png, mediaType: 'image/png', context: 'SECRET-CONTEXT' });
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('SECRET');
  });

  it('rejects unknown kinds and malformed bodies with 400', async () => {
    expect((await post({ kind: 'grade' })).statusCode).toBe(400);
    expect((await post('not json')).statusCode).toBe(400);
    expect((await post({}, 'GET')).statusCode).toBe(405);
  });
});
