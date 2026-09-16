/**
 * Everything here runs without AWS.
 *
 * The parts of this service that can be wrong *offline* are the voice table,
 * the Polly-limit split, and the log redaction — and those are exactly the
 * parts that are expensive to discover in production: a bad voice id means
 * silence for a student, a bad split means a truncated sentence, a leaky log
 * means reviewed course content in CloudWatch. None of them need a credential
 * to test, so none of them are tested against live AWS.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickVoice, KNOWN_VOICE_IDS, SUPPORTED_LANGUAGES } from '../src/voices';
import { splitForSpeech, MAX_INPUT_CHARS, POLLY_TEXT_LIMIT } from '../src/text';
import { project, REDACTION_ALLOWLIST } from '../src/log';
import { handler, pickVoice as reExportedPickVoice, TRANSLATED_NOTICE } from '../src/handler';

/**
 * Every log line the handler emits, captured so a test can assert that none of
 * them carry course content. This is the check that would actually catch a
 * `console.log(request)` added while debugging.
 */
const logLines: string[] = [];
const realLog = console.log;
console.log = (line: unknown) => {
  logLines.push(String(line));
};
afterAll(() => {
  console.log = realLog;
});

/**
 * The contract this service promises. Asserted as a literal table rather than
 * derived from the implementation, so that editing `voices.ts` and editing the
 * promise are two separate, visible acts.
 */
const EXPECTED: Array<[lang: string, voiceId: string, neural: boolean]> = [
  ['en', 'Joanna', true],
  ['es', 'Lucia', true],
  ['fr', 'Lea', true],
  ['de', 'Vicki', true],
  ['pt', 'Camila', true],
  ['it', 'Bianca', true],
  ['zh', 'Zhiyu', true],
  ['ja', 'Takumi', true],
  ['ko', 'Seoyeon', true],
  ['hi', 'Kajal', true],
  ['ar', 'Zeina', false],
  ['ru', 'Tatyana', false],
];

describe('pickVoice: required languages', () => {
  it.each(EXPECTED)('%s maps to %s (neural: %s)', (lang, voiceId, neural) => {
    const voice = pickVoice(lang);
    expect(voice.voiceId).toBe(voiceId);
    expect(voice.supportsNeural).toBe(neural);
  });

  it('covers every language the module advertises', () => {
    expect([...SUPPORTED_LANGUAGES].sort()).toEqual(EXPECTED.map(([lang]) => lang).sort());
  });

  it('returns a language code alongside every voice', () => {
    for (const [lang] of EXPECTED) {
      expect(pickVoice(lang).languageCode).toMatch(/^[a-z]{2,3}(-[A-Z]{2})?$/);
    }
  });
});

describe('pickVoice: neural flags match Polly reality', () => {
  // These two are the reason `supportsNeural` exists at all. Polly has no
  // neural build for Russian or for Modern Standard Arabic, so asking for
  // `neural` on them fails the whole synthesis call.
  it('marks Russian as standard-only', () => {
    expect(pickVoice('ru').supportsNeural).toBe(false);
    expect(pickVoice('ru-RU').voiceId).toBe('Tatyana');
  });

  it('marks Modern Standard Arabic as standard-only', () => {
    const voice = pickVoice('ar');
    expect(voice.voiceId).toBe('Zeina');
    expect(voice.languageCode).toBe('arb');
    expect(voice.supportsNeural).toBe(false);
  });

  it('uses the neural Gulf Arabic voice when the locale asks for it', () => {
    const voice = pickVoice('ar-AE');
    expect(voice.voiceId).toBe('Hala');
    expect(voice.supportsNeural).toBe(true);
  });

  it('knows Aditi is the standard-engine Hindi voice', () => {
    expect(pickVoice('hi', 'Aditi')).toEqual({
      voiceId: 'Aditi',
      languageCode: 'hi-IN',
      supportsNeural: false,
    });
  });
});

describe('pickVoice: tag normalisation', () => {
  it.each([
    ['ES', 'Lucia'],
    ['es-ES', 'Lucia'],
    ['  fr  ', 'Lea'],
    ['ja-JP', 'Takumi'],
    ['zh-Hans-CN', 'Zhiyu'],
    ['pt_BR', 'Camila'],
  ])('%s resolves to %s', (tag, voiceId) => {
    expect(pickVoice(tag).voiceId).toBe(voiceId);
  });

  it('prefers a regional voice when one exists', () => {
    expect(pickVoice('es-MX').voiceId).toBe('Mia');
    expect(pickVoice('en-GB').voiceId).toBe('Amy');
  });

  it('falls back to the base language when the region has no voice', () => {
    expect(pickVoice('es-AR').voiceId).toBe('Lucia');
    expect(pickVoice('en-AU').voiceId).toBe('Joanna');
  });
});

describe('pickVoice: an explicit voice wins', () => {
  it('overrides the language default', () => {
    expect(pickVoice('es', 'Matthew')).toEqual({
      voiceId: 'Matthew',
      languageCode: 'en-US',
      supportsNeural: true,
    });
  });

  it('carries the requested voice’s own engine support, not the language’s', () => {
    // `de` defaults to a neural voice; asking for Tatyana must not inherit that.
    expect(pickVoice('de', 'Tatyana').supportsNeural).toBe(false);
  });

  it('honours an unknown voice id but assumes standard engine', () => {
    // Polly gains voices faster than this table does. Passing the id through is
    // right; guessing `neural` on it would turn a working call into a failure.
    const voice = pickVoice('fr', 'SomeVoiceAddedNextYear');
    expect(voice.voiceId).toBe('SomeVoiceAddedNextYear');
    expect(voice.supportsNeural).toBe(false);
  });

  it('ignores a blank or whitespace-only request', () => {
    expect(pickVoice('de', '').voiceId).toBe('Vicki');
    expect(pickVoice('de', '   ').voiceId).toBe('Vicki');
    expect(pickVoice('de', undefined).voiceId).toBe('Vicki');
  });
});

describe('pickVoice: unknown languages', () => {
  it.each(['', '   ', 'xx', 'klingon', 'tlh-Piqd', '!!', '123'])(
    'falls back to English for %j instead of throwing',
    (tag) => {
      const voice = pickVoice(tag);
      expect(voice.voiceId).toBe('Joanna');
      expect(voice.languageCode).toBe('en-US');
      expect(voice.supportsNeural).toBe(true);
    },
  );
});

describe('voice registry integrity', () => {
  it('every default voice is a registered voice', () => {
    for (const [, voiceId] of EXPECTED) {
      expect(KNOWN_VOICE_IDS).toContain(voiceId);
    }
  });

  it('voice ids are Polly-shaped: capitalised, alphabetic, no locale suffix', () => {
    for (const voiceId of KNOWN_VOICE_IDS) {
      expect(voiceId).toMatch(/^[A-Z][A-Za-z]+$/);
    }
  });

  it('is re-exported from the handler so callers need one import', () => {
    expect(reExportedPickVoice('ko').voiceId).toBe('Seoyeon');
  });
});

describe('splitForSpeech', () => {
  it('leaves text within the limit untouched', () => {
    expect(splitForSpeech('One sentence.', POLLY_TEXT_LIMIT)).toEqual(['One sentence.']);
  });

  it('keeps every chunk within the limit', () => {
    const text = 'The cell membrane regulates transport. '.repeat(120);
    const chunks = splitForSpeech(text, POLLY_TEXT_LIMIT);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(POLLY_TEXT_LIMIT);
  });

  it('loses no characters — a truncated reviewed sentence is the failure mode', () => {
    const text = 'Alpha. Beta! Gamma? Delta.\nEpsilon.'.repeat(40);
    expect(splitForSpeech(text, 100).join('')).toBe(text);
  });

  it('prefers sentence boundaries over hard cuts', () => {
    const chunks = splitForSpeech('aaaa. bbbb. cccc. dddd.', 12);
    for (const chunk of chunks) expect(chunk.trimEnd()).toMatch(/\.$/);
  });

  it('splits on CJK full-width stops', () => {
    const text = '細胞膜は輸送を調節します。'.repeat(20);
    const chunks = splitForSpeech(text, 60);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.endsWith('。')).toBe(true);
  });

  it('hard-slices a single sentence longer than the limit rather than looping', () => {
    const text = 'x'.repeat(250);
    const chunks = splitForSpeech(text, 100);
    expect(chunks).toHaveLength(3);
    expect(chunks.join('')).toBe(text);
  });

  it('accepts anything the request cap allows, since translation expands text', () => {
    // A legal 3000-character request can translate to well over Polly's limit.
    const translated = 'Satz. '.repeat(Math.ceil((MAX_INPUT_CHARS * 1.4) / 6));
    expect(translated.length).toBeGreaterThan(POLLY_TEXT_LIMIT);
    const chunks = splitForSpeech(translated, POLLY_TEXT_LIMIT);
    expect(chunks.join('')).toBe(translated);
  });
});

describe('log redaction', () => {
  it('the allowlist has not quietly grown', () => {
    expect(REDACTION_ALLOWLIST).toEqual(['event', 'targetLang', 'chars', 'spoke']);
  });

  it('drops the translated text even when handed the whole request', () => {
    const projected = project({
      event: 'translated',
      targetLang: 'es',
      chars: 42,
      spoke: true,
      text: 'the mitochondrion is the powerhouse of the cell',
      translatedText: 'la mitocondria es la central eléctrica de la célula',
      voice: 'Lucia',
    });
    expect(projected).toEqual({ event: 'translated', targetLang: 'es', chars: 42, spoke: true });
    expect(JSON.stringify(projected)).not.toContain('mitocondria');
  });

  it('drops non-primitive values, so a nested request object cannot ride along', () => {
    // The allowlist is by field *name*; this is the second guard. Without it,
    // `logOperation({ event, chars: requestBody })` would serialise the whole
    // body under an allowlisted key.
    const projected = project({
      event: 'translated',
      chars: { text: 'reviewed caption' } as unknown as number,
      targetLang: ['es'] as unknown as string,
      spoke: (() => true) as unknown as boolean,
    });
    expect(projected).toEqual({ event: 'translated' });
  });
});

describe('provenance', () => {
  it('leads with the caveat, so an audio-only student hears it first', () => {
    expect(TRANSLATED_NOTICE).toMatch(/^Machine-translated/);
    expect(TRANSLATED_NOTICE).toContain('reviewed');
  });
});

/**
 * Handler-level behaviour, with both AWS clients replaced by fakes.
 *
 * Nothing here talks to AWS. The point is the wiring the pure functions above
 * cannot cover: the provenance label, the input cap, the engine downgrade, and
 * the guarantee that a failed voice does not take a good translation with it.
 */
const translateCalls: Array<Record<string, unknown>> = [];
const pollyCalls: Array<Record<string, unknown>> = [];
let translateImpl: (input: Record<string, unknown>) => Record<string, unknown>;
let pollyImpl: (input: Record<string, unknown>) => Record<string, unknown>;

vi.mock('@aws-sdk/client-translate', () => ({
  TranslateClient: class {
    async send(command: { input: Record<string, unknown> }) {
      translateCalls.push(command.input);
      return translateImpl(command.input);
    }
  },
  TranslateTextCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

vi.mock('@aws-sdk/client-polly', () => ({
  PollyClient: class {
    async send(command: { input: Record<string, unknown> }) {
      pollyCalls.push(command.input);
      return pollyImpl(command.input);
    }
  },
  SynthesizeSpeechCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

const audio = (bytes: number[]) => ({
  AudioStream: { transformToByteArray: async () => new Uint8Array(bytes) },
});

const post = (body: unknown) => ({
  requestContext: { http: { method: 'POST' } },
  body: JSON.stringify(body),
});

const parse = (result: { body: string }) => JSON.parse(result.body) as Record<string, unknown>;

describe('handler', () => {
  beforeEach(() => {
    translateCalls.length = 0;
    pollyCalls.length = 0;
    translateImpl = () => ({ TranslatedText: 'la célula', SourceLanguageCode: 'en' });
    pollyImpl = () => audio([1, 2, 3]);
    logLines.length = 0;
  });

  it('answers the CORS preflight without touching AWS', async () => {
    const result = await handler({ requestContext: { http: { method: 'OPTIONS' } } });
    expect(result.statusCode).toBe(204);
    expect(result.headers['access-control-allow-origin']).toBe('*');
    expect(result.headers['access-control-allow-methods']).toContain('POST');
    expect(translateCalls).toHaveLength(0);
  });

  it('puts permissive CORS on real responses too', async () => {
    const result = await handler(post({ text: 'the cell', targetLang: 'es' }));
    expect(result.headers['access-control-allow-origin']).toBe('*');
  });

  it('marks output as reviewed-translated, never generated', async () => {
    const body = parse(await handler(post({ text: 'the cell', targetLang: 'es' })));
    expect(body.provenance).toBe('reviewed-translated');
    expect(body.provenance).not.toBe('generated');
    expect(body.translatedText).toBe('la célula');
    expect(body.notice).toBe(TRANSLATED_NOTICE);
  });

  it('detects the source language when none is given', async () => {
    await handler(post({ text: 'the cell', targetLang: 'es' }));
    expect(translateCalls[0]?.SourceLanguageCode).toBe('auto');
  });

  it('passes an explicit source language straight through', async () => {
    await handler(post({ text: 'the cell', targetLang: 'es', sourceLang: 'en' }));
    expect(translateCalls[0]?.SourceLanguageCode).toBe('en');
  });

  it('rejects text past the cap instead of truncating reviewed material', async () => {
    const result = await handler(post({ text: 'x'.repeat(MAX_INPUT_CHARS + 1), targetLang: 'es' }));
    expect(result.statusCode).toBe(400);
    const body = parse(result);
    expect(body.limit).toBe(MAX_INPUT_CHARS);
    expect(body.chars).toBe(MAX_INPUT_CHARS + 1);
    expect(translateCalls).toHaveLength(0);
  });

  it.each([
    [{ targetLang: 'es' }, 'missing text'],
    [{ text: '   ', targetLang: 'es' }, 'blank text'],
    [{ text: 'the cell' }, 'missing targetLang'],
  ])('400s on %j (%s)', async (body) => {
    expect((await handler(post(body))).statusCode).toBe(400);
  });

  it('400s on a malformed body', async () => {
    const result = await handler({ requestContext: { http: { method: 'POST' } }, body: '{oops' });
    expect(result.statusCode).toBe(400);
  });

  it('does not speak unless asked', async () => {
    const body = parse(await handler(post({ text: 'the cell', targetLang: 'es' })));
    expect(pollyCalls).toHaveLength(0);
    expect(body.audioBase64).toBeUndefined();
  });

  it('returns base64 mp3 from the neural engine when asked to speak', async () => {
    const body = parse(await handler(post({ text: 'the cell', targetLang: 'es', speak: true })));
    expect(pollyCalls[0]).toMatchObject({ VoiceId: 'Lucia', Engine: 'neural', OutputFormat: 'mp3' });
    expect(body.voiceEngine).toBe('neural');
    expect(body.contentType).toBe('audio/mpeg');
    expect(Buffer.from(String(body.audioBase64), 'base64')).toEqual(Buffer.from([1, 2, 3]));
  });

  it('asks for the standard engine directly for a standard-only language', async () => {
    const body = parse(await handler(post({ text: 'the cell', targetLang: 'ru', speak: true })));
    expect(pollyCalls[0]).toMatchObject({ VoiceId: 'Tatyana', Engine: 'standard' });
    expect(body.voiceEngine).toBe('standard');
  });

  it('downgrades to standard and says so rather than failing', async () => {
    pollyImpl = (input) => {
      if (input.Engine === 'neural') throw new Error('ValidationException');
      return audio([9, 9]);
    };
    const body = parse(await handler(post({ text: 'the cell', targetLang: 'es', speak: true })));
    expect(pollyCalls.map((call) => call.Engine)).toEqual(['neural', 'standard']);
    expect(body.voiceEngine).toBe('standard');
    expect(body.audioBase64).toBeTruthy();
  });

  it('keeps the translation when speech fails outright', async () => {
    pollyImpl = () => {
      throw new Error('ServiceUnavailable');
    };
    const result = await handler(post({ text: 'the cell', targetLang: 'ru', speak: true }));
    expect(result.statusCode).toBe(200);
    const body = parse(result);
    expect(body.translatedText).toBe('la célula');
    expect(body.speechUnavailable).toBe(true);
    expect(body.audioBase64).toBeUndefined();
  });

  it('502s cleanly when Translate is unreachable', async () => {
    translateImpl = () => {
      throw new Error('ThrottlingException');
    };
    const result = await handler(post({ text: 'the cell', targetLang: 'es' }));
    expect(result.statusCode).toBe(502);
    expect(parse(result).error).toBeTypeOf('string');
    expect(parse(result).translatedText).toBeUndefined();
  });

  it('502s when Translate returns nothing usable', async () => {
    translateImpl = () => ({ TranslatedText: '   ' });
    expect((await handler(post({ text: 'the cell', targetLang: 'es' }))).statusCode).toBe(502);
  });

  it('splits a translation that outgrew Polly across calls, keeping one voice', async () => {
    translateImpl = () => ({ TranslatedText: 'Satz. '.repeat(700), SourceLanguageCode: 'en' });
    await handler(post({ text: 'sentence. '.repeat(200), targetLang: 'de', speak: true }));
    expect(pollyCalls.length).toBeGreaterThan(1);
    for (const call of pollyCalls) {
      expect(call.VoiceId).toBe('Vicki');
      expect(String(call.Text).length).toBeLessThanOrEqual(3000);
    }
  });

  it('decodes a base64-encoded Function URL body', async () => {
    const result = await handler({
      requestContext: { http: { method: 'POST' } },
      isBase64Encoded: true,
      body: Buffer.from(JSON.stringify({ text: 'the cell', targetLang: 'es' })).toString('base64'),
    });
    expect(result.statusCode).toBe(200);
  });

  it('405s on a method other than POST', async () => {
    expect((await handler({ requestContext: { http: { method: 'GET' } } })).statusCode).toBe(405);
  });

  it('never logs the text or the translation', async () => {
    await handler(post({ text: 'the mitochondrion', targetLang: 'es', speak: true }));
    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) {
      expect(line).not.toContain('mitochondrion');
      expect(line).not.toContain('célula');
      expect(Object.keys(JSON.parse(line))).toEqual(
        expect.arrayContaining([]),
      );
      for (const key of Object.keys(JSON.parse(line) as object)) {
        expect(REDACTION_ALLOWLIST).toContain(key);
      }
    }
    expect(JSON.parse(logLines[logLines.length - 1] ?? '{}')).toEqual({
      event: 'translated',
      targetLang: 'es',
      chars: 17,
      spoke: true,
    });
  });
});
