/**
 * What a student actually reads, asserted against the real contract.
 *
 * `LiveEventSchema` is imported from `apps/extension/src/shared/contracts.ts`
 * rather than mirrored here on purpose. A local copy of a `.strict()` schema
 * passes forever while the real one starts rejecting -- which is not
 * hypothetical, `caption.appended` gained its payload only at T-16. If the
 * contract moves, these tests fail here rather than on stage.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveEventSchema } from '../../../apps/extension/src/shared/contracts.js';
import {
  MAX_CAPTION_CHARS,
  toCaptionEvents,
  type TranscriptResultLike,
} from '../src/captions.js';
import { logEvent, REDACTION_ALLOWLIST } from '../src/log.js';
// Stubbed so the handler's own contract -- response shape, and a clean 502
// instead of a throw -- is testable without a credential or a network.
const transcribeChunk = vi.hoisted(() => vi.fn());
vi.mock('../src/transcribe.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/transcribe.js')>()),
  transcribeChunk,
}));

import { handler, MAX_AUDIO_BYTES } from '../src/handler.js';

const SESSION = 'sess-demo-0001';
const PACK = 'bio-cell-demo';

const result = (
  Transcript: string,
  IsPartial?: boolean,
  LanguageCode?: string,
): TranscriptResultLike => ({ IsPartial, Alternatives: [{ Transcript }], LanguageCode });

const emit = (results: TranscriptResultLike[], startSequence = 0) =>
  toCaptionEvents(results, SESSION, PACK, 1, startSequence);

/** Every event this service produces must survive the frozen contract. */
const expectValid = (events: unknown[]) => {
  for (const event of events) {
    const parsed = LiveEventSchema.safeParse(event);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
  }
};

const post = (body: unknown, method = 'POST') =>
  handler({
    requestContext: { http: { method } },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

afterEach(() => vi.restoreAllMocks());

describe('toCaptionEvents', () => {
  it('maps IsPartial onto isFinal in both directions', () => {
    const events = emit([
      result('The cell wall is', true),
      result('The cell wall is rigid.', false),
    ]);

    expect(events.map((event) => event.caption.isFinal)).toEqual([false, true]);
    expectValid(events);
  });

  it('treats a result with no IsPartial flag as settled', () => {
    const [event] = emit([result('Mitochondria release energy.')]);
    expect(event?.caption.isFinal).toBe(true);
  });

  it('increments sequence from the caller start point', () => {
    const events = emit([result('One.'), result('Two.'), result('Three.')], 41);
    expect(events.map((event) => event.sequence)).toEqual([41, 42, 43]);
    expectValid(events);
  });

  it('does not burn sequence numbers on results it drops', () => {
    // A gap in the sequence tells a student's renderer it missed an event and
    // should wait for a replay that is never coming.
    const events = emit([result('One.'), result('   '), result('Two.')], 7);
    expect(events.map((event) => event.sequence)).toEqual([7, 8]);
  });

  it('produces zero events for an empty transcript', () => {
    expect(emit([]).length).toBe(0);
    expect(emit([result('')]).length).toBe(0);
    expect(emit([result('   \n\t ')]).length).toBe(0);
    expect(emit([{ IsPartial: false, Alternatives: [] }]).length).toBe(0);
    expect(emit([{ IsPartial: false }]).length).toBe(0);
    expect(toCaptionEvents(undefined, SESSION, PACK, 1, 0).length).toBe(0);
  });

  it('never emits an empty caption string', () => {
    // `text` is min(1): an empty caption is not a blank line, it is a rejected
    // event, so silence has to produce nothing at all.
    const events = emit([result(''), result('  '), result('Real speech.')]);
    expect(events.length).toBe(1);
    for (const event of events) expect(event.caption.text.length).toBeGreaterThan(0);
    expectValid(events);
  });

  it('truncates text over the contract maximum', () => {
    const [event] = emit([result('a'.repeat(MAX_CAPTION_CHARS + 1000))]);
    expect(event?.caption.text.length).toBe(MAX_CAPTION_CHARS);
    expectValid([event]);
  });

  it('keeps a truncated caption a prefix of what was said, and valid', () => {
    const spoken = `${'word '.repeat(600)}end`;
    const [event] = emit([result(spoken)]);
    const text = event?.caption.text ?? '';
    expect(text.length).toBeLessThanOrEqual(MAX_CAPTION_CHARS);
    expect(spoken.startsWith(text)).toBe(true);
    expectValid([event]);
  });

  it('carries lang when it is a usable code and drops it when it is not', () => {
    const [labelled] = emit([result('Hola.', false, 'es-ES')]);
    expect(labelled?.caption.lang).toBe('es-ES');

    const [bare] = emit([result('Hello.', false, 'e')]);
    expect(bare?.caption).not.toHaveProperty('lang');
    expectValid([labelled, bare]);
  });

  it('emits contract-valid events and claims nothing about the slide', () => {
    const events = emit([result('The nucleus holds the DNA.', false, 'en-US')], 3);
    expectValid(events);

    // `.strict()` with no assetId is the contract refusing to let a caption
    // assert what is on screen. Asserted directly so a well-meant "helpful"
    // field is caught here rather than by the relay dropping the event.
    expect(events[0]).not.toHaveProperty('assetId');
    expect(Object.keys(events[0] ?? {}).sort()).toEqual(
      ['caption', 'packId', 'packVersion', 'schemaVersion', 'sentAt', 'sequence', 'sessionId', 'type'],
    );
  });
});

describe('handler', () => {
  it('answers a CORS preflight without reading the body', async () => {
    const response = await handler({ requestContext: { http: { method: 'OPTIONS' } } });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.headers['access-control-allow-methods']).toContain('POST');
  });

  it('sends CORS headers on errors too, so the extension can read them', async () => {
    const response = await post('not json at all');
    expect(response.statusCode).toBe(400);
    expect(response.headers['access-control-allow-origin']).toBe('*');
  });

  it('rejects a method it does not serve', async () => {
    const response = await post({}, 'GET');
    expect(response.statusCode).toBe(405);
  });

  it('rejects a request with no sessionId', async () => {
    const response = await post({ audio: 'AAAA' });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe('invalid_session');
  });

  it('rejects a request with no audio', async () => {
    const response = await post({ sessionId: SESSION });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe('invalid_audio');
  });

  it('returns the caption payloads for a transcribed chunk', async () => {
    transcribeChunk.mockResolvedValue([
      result('The cell wall is', true, 'en-US'),
      result('', false, 'en-US'),
      result('The cell wall is rigid.', false, 'en-US'),
    ]);

    const response = await post({ sessionId: SESSION, audio: 'UklGRiQAAABXQVZF' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      captions: [
        { text: 'The cell wall is', isFinal: false, lang: 'en-US' },
        { text: 'The cell wall is rigid.', isFinal: true, lang: 'en-US' },
      ],
    });
  });

  it('returns an empty caption list rather than a blank caption for silence', async () => {
    transcribeChunk.mockResolvedValue([result('   ', false, 'en-US')]);
    const response = await post({ sessionId: SESSION, audio: 'UklGRiQAAABXQVZF' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ captions: [] });
  });

  it('answers a Transcribe failure with a clean 502 and never throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    transcribeChunk.mockRejectedValue(new Error('BadRequestException: stream closed'));

    const response = await post({ sessionId: SESSION, audio: 'UklGRiQAAABXQVZF' });
    expect(response.statusCode).toBe(502);
    expect(JSON.parse(response.body).error).toBe('transcription_failed');
    // The SDK message can quote the failed request, and the request is audio.
    expect(response.body).not.toContain('stream closed');
    expect(response.headers['access-control-allow-origin']).toBe('*');
  });

  it('rejects audio over the size limit with a clear 400', async () => {
    const oversized = 'A'.repeat(Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 4096);
    const response = await post({ sessionId: SESSION, audio: oversized });

    expect(response.statusCode).toBe(400);
    const payload = JSON.parse(response.body);
    expect(payload.error).toBe('audio_too_large');
    expect(payload.message).toContain(String(MAX_AUDIO_BYTES));
    expect(payload.message).toMatch(/seconds/);
  });
});

describe('redacted logging', () => {
  const EVENT = {
    schemaVersion: '1.0',
    type: 'caption.appended',
    sessionId: SESSION,
    packId: PACK,
    packVersion: 1,
    sequence: 12,
    sentAt: '2026-09-16T15:00:24.000Z',
    caption: { text: 'The mitochondrion releases energy the cell can use.', isFinal: true, lang: 'en-US' },
  };

  const captured = () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    return () => String(spy.mock.calls.at(-1)?.[0] ?? '');
  };

  it('logs the operational fields', () => {
    const line = captured();
    logEvent('info', 'captions-emitted', EVENT, { count: 2 });
    expect(JSON.parse(line())).toMatchObject({
      level: 'info',
      message: 'captions-emitted',
      type: 'caption.appended',
      sessionId: SESSION,
      sequence: 12,
      count: 2,
    });
  });

  it('never logs transcript text', () => {
    const line = captured();
    logEvent('info', 'captions-emitted', EVENT);
    const raw = line();

    // Substring checks, not key checks: a nested object satisfies a key check
    // while still putting the instructor's words in CloudWatch.
    for (const spoken of ['mitochondrion', 'releases energy', 'the cell can use']) {
      expect(raw, `leaked "${spoken}"`).not.toContain(spoken);
    }
    expect(JSON.parse(raw)).not.toHaveProperty('caption');
  });

  it('drops a content field nobody anticipated', () => {
    const line = captured();
    logEvent('warn', 'captions-rejected', {
      ...EVENT,
      transcript: 'the whole lecture, verbatim',
      audio: 'UklGRiQAAABXQVZF',
    });
    const raw = line();
    expect(raw).not.toContain('verbatim');
    expect(raw).not.toContain('UklGRiQAAABXQVZF');
  });

  it('keeps the allowlist to operational fields only', () => {
    // If this fails, someone widened the allowlist. That may be right -- but it
    // is a charter-adjacent decision, so it should be a deliberate edit to this
    // list rather than a side effect of adding a field to the event.
    expect([...REDACTION_ALLOWLIST].sort()).toEqual(
      ['packId', 'packVersion', 'sequence', 'sessionId', 'type'].sort(),
    );
  });
});
