import { describe, expect, it, vi } from 'vitest';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { issueCapability } from '../../live-session/src/capability.js';
import { answerQuestion, QUESTION_MAX_LENGTH, SYSTEM_PROMPT } from '../src/ask.js';
import { authorize } from '../src/auth.js';
import { createHandler, RATE_LIMIT_PER_MINUTE, type Deps, type HttpEvent } from '../src/handler.js';
import { reviewedPack, type ReviewedPack } from '../src/packs.js';
import { passagesFor, retrieve } from '../src/retrieve.js';
import { reviewedText } from '../src/speak.js';
import { presignTranscribeUrl } from '../src/transcribe.js';
import { readWav, transcribeClip } from '../src/whisper.js';

/** 16-bit mono WAV of a tone at `amplitude` (0 for silence). */
function wav(seconds: number, amplitude = 3000, sampleRate = 16000, channels = 1): Uint8Array {
  const count = Math.round(seconds * sampleRate);
  const bytes = new Uint8Array(44 + count * 2 * channels);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2 * channels, true); view.setUint16(32, 2 * channels, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, count * 2 * channels, true);
  for (let i = 0; i < count * channels; i++) view.setInt16(44 + i * 2, Math.round(amplitude * Math.sin(i / 8)), true);
  return bytes;
}

const SECRET = 'test-secret-with-enough-entropy-000000000000';
const NOW = new Date('2026-09-16T18:00:00Z');
const pack = reviewedPack('bio-cell-demo', 1)!;
const student = issueCapability('SESS01', 'student', SECRET, NOW);
const instructor = issueCapability('SESS01', 'instructor', SECRET, NOW);

describe('authorize', () => {
  it('accepts a valid capability for an allowed role and names its session', () => {
    expect(authorize(student, SECRET, ['student'], NOW)).toEqual({ ok: true, role: 'student', sessionId: 'SESS01' });
  });

  it('refuses a forged role, an expired capability, a missing one, and a disallowed role', () => {
    expect(authorize({ ...student, role: 'instructor' }, SECRET, ['instructor'], NOW)).toMatchObject({ ok: false, status: 401 });
    expect(authorize(student, SECRET, ['student'], new Date(NOW.getTime() + 5 * 3600_000))).toMatchObject({ ok: false, status: 401, reason: 'capability-expired' });
    expect(authorize(undefined, SECRET, ['student'], NOW)).toMatchObject({ ok: false, status: 401 });
    expect(authorize(student, SECRET, ['instructor'], NOW)).toMatchObject({ ok: false, status: 403 });
  });
});

describe('reviewed packs only', () => {
  it('serves the reviewed pack and refuses unknown versions and draft packs', () => {
    expect(pack.packId).toBe('bio-cell-demo');
    expect(reviewedPack('bio-cell-demo', 2)).toBeNull();
    const draft: ReviewedPack = { ...pack, packId: 'hnsw', review: { status: 'draft' } };
    expect(reviewedPack('hnsw', 1, [draft])).toBeNull();
    expect(reviewedPack('hnsw', 1, [{ ...draft, review: undefined }])).toBeNull();
  });
});

describe('retrieve', () => {
  it('finds the mitochondrion for a question about mitochondria and energy', () => {
    const hits = retrieve(pack, 'What do mitochondria do for energy?');
    expect(hits[0]?.passage.regionId).toBe('mitochondrion');
  });

  it('returns nothing for a question the lesson does not touch', () => {
    expect(retrieve(pack, 'Who won the 1998 World Cup?')).toEqual([]);
  });

  it('indexes every reviewed region exactly once', () => {
    const passages = passagesFor(pack);
    const regions = pack.assets.reduce((n, a) => n + a.regions.length, 0);
    expect(passages).toHaveLength(regions);
    expect(new Set(passages.map(p => p.id)).size).toBe(regions);
  });
});

describe('answerQuestion', () => {
  const question = 'What does the mitochondrion do?';

  it('returns a cited answer when the model cites sources it was given, and shows it only those sources', async () => {
    const callModel = vi.fn(async ({ user }: { system: string; user: string }) => {
      const id = /source id="([^"]+mitochondrion)"/.exec(user)![1];
      return { status: 'answered', answer: 'It releases usable energy for the cell.', sourceIds: [id] };
    });
    const result = await answerQuestion(question, pack, callModel);
    expect(result).toMatchObject({ status: 'answered', citations: [{ regionId: 'mitochondrion' }] });
    const { system, user } = callModel.mock.calls[0]![0];
    expect(system).toBe(SYSTEM_PROMPT);
    expect(user).toContain(question);
    expect((user.match(/<source /g) ?? []).length).toBeLessThanOrEqual(4);
  });

  it('turns an answer citing an unseen source, or no source, into a decline', async () => {
    const invented = await answerQuestion(question, pack, async () => ({ status: 'answered', answer: 'Made up.', sourceIds: ['cell-slide-99#spleen'] }));
    expect(invented).toEqual({ status: 'declined', reason: 'not-supported-by-material' });
    const uncited = await answerQuestion(question, pack, async () => ({ status: 'answered', answer: 'Trust me.', sourceIds: [] }));
    expect(uncited).toEqual({ status: 'declined', reason: 'not-supported-by-material' });
  });

  it('passes a model decline, a refusal, and a model error through as declines', async () => {
    expect(await answerQuestion(question, pack, async () => ({ status: 'declined', answer: '', sourceIds: [] }))).toMatchObject({ status: 'declined' });
    expect(await answerQuestion(question, pack, async () => null)).toMatchObject({ status: 'declined', reason: 'not-supported-by-material' });
    expect(await answerQuestion(question, pack, async () => { throw new Error('throttled'); })).toEqual({ status: 'declined', reason: 'model-unavailable' });
  });

  it('never calls the model when nothing reviewed is relevant or the question is invalid', async () => {
    const callModel = vi.fn();
    expect(await answerQuestion('Who won the 1998 World Cup?', pack, callModel)).toEqual({ status: 'declined', reason: 'no-reviewed-material' });
    expect(await answerQuestion('x'.repeat(QUESTION_MAX_LENGTH + 1), pack, callModel)).toEqual({ status: 'declined', reason: 'question-invalid' });
    expect(await answerQuestion(42, pack, callModel)).toEqual({ status: 'declined', reason: 'question-invalid' });
    expect(callModel).not.toHaveBeenCalled();
  });
});

describe('reviewedText', () => {
  it('returns only a named field of a region in the pack', () => {
    expect(reviewedText(pack, 'cell-slide-03', 'mitochondrion', 'plainLanguage')).toBe('This structure helps power the cell.');
    expect(reviewedText(pack, 'cell-slide-03', 'spleen', 'plainLanguage')).toBeNull();
    expect(reviewedText(pack, 'cell-slide-03', 'mitochondrion', 'anything I like')).toBeNull();
  });
});

describe('presignTranscribeUrl', () => {
  it('signs a short-lived Transcribe streaming URL for 16 kHz PCM', async () => {
    const signer = new SignatureV4({ credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', sessionToken: 'token' }, region: 'us-east-1', service: 'transcribe', sha256: Sha256 });
    const url = new URL(await presignTranscribeUrl(signer, 'us-east-1', NOW));
    expect(url.protocol).toBe('wss:');
    expect(url.host).toBe('transcribestreaming.us-east-1.amazonaws.com:8443');
    expect(url.pathname).toBe('/stream-transcription-websocket');
    expect(url.searchParams.get('media-encoding')).toBe('pcm');
    expect(url.searchParams.get('sample-rate')).toBe('16000');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Security-Token')).toBe('token');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('X-Amz-Credential')).toContain('/us-east-1/transcribe/aws4_request');
  });
});

describe('transcribeClip (Whisper)', () => {
  it('reads a 16 kHz mono WAV and returns the endpoint text, tidied', async () => {
    expect(readWav(wav(1))).toMatchObject({ sampleRate: 16000, channels: 1, bitsPerSample: 16, format: 1 });
    const invoke = vi.fn(async () => ({ text: '  Now look at   the nucleus. ' }));
    await expect(transcribeClip(wav(1.5), invoke)).resolves.toEqual({ status: 'ok', text: 'Now look at the nucleus.' });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('never sends silence, and drops the stock phrases Whisper invents from noise', async () => {
    const invoke = vi.fn(async () => [{ text: 'Thanks for watching!' }]);
    await expect(transcribeClip(wav(1, 0), invoke)).resolves.toEqual({ status: 'ok', text: '' });
    expect(invoke).not.toHaveBeenCalled();
    await expect(transcribeClip(wav(1), invoke)).resolves.toEqual({ status: 'ok', text: '' });
  });

  it('refuses what is not a short 16 kHz mono clip, and reports an endpoint failure as unavailable', async () => {
    const invoke = vi.fn(async () => ({ text: 'x' }));
    await expect(transcribeClip(new TextEncoder().encode('not audio at all, just some words'), invoke)).resolves.toMatchObject({ reason: 'audio-not-wav' });
    await expect(transcribeClip(wav(1, 3000, 44100), invoke)).resolves.toMatchObject({ reason: 'audio-format-unsupported' });
    await expect(transcribeClip(wav(1, 3000, 16000, 2), invoke)).resolves.toMatchObject({ reason: 'audio-format-unsupported' });
    await expect(transcribeClip(wav(0.1), invoke)).resolves.toMatchObject({ reason: 'audio-too-short' });
    await expect(transcribeClip(wav(13), invoke)).resolves.toMatchObject({ reason: 'audio-too-long' });
    expect(invoke).not.toHaveBeenCalled();
    await expect(transcribeClip(wav(1), async () => { throw new Error('ValidationError: endpoint not found'); })).resolves.toEqual({ status: 'unavailable' });
    await expect(transcribeClip(wav(1), async () => ({ unexpected: true }))).resolves.toEqual({ status: 'unavailable' });
  });
});

describe('handler', () => {
  function setup(overrides: Partial<Deps> = {}) {
    const deps: Deps = {
      secret: SECRET,
      region: 'us-east-1',
      now: () => NOW,
      callModel: vi.fn(async ({ user }) => ({ status: 'answered', answer: 'It powers the cell.', sourceIds: [/source id="([^"]+mitochondrion)"/.exec(user)![1]] })),
      synthesize: vi.fn(async () => new Uint8Array([1, 2, 3])),
      signer: { presign: vi.fn(async request => ({ path: request.path, query: { ...request.query, 'X-Amz-Signature': 'abc' } })) },
      ...overrides,
    };
    return { deps, handle: createHandler(deps) };
  }
  const post = (route: string, body: unknown): HttpEvent => ({ rawPath: `/${route}`, requestContext: { http: { method: 'POST' } }, body: JSON.stringify(body) });

  it('answers a student question with citations', async () => {
    const { handle } = setup();
    const result = await handle(post('ask', { capability: student, packId: 'bio-cell-demo', packVersion: 1, question: 'What does the mitochondrion do?' }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({ status: 'answered', citations: [{ regionId: 'mitochondrion' }] });
  });

  it('refuses without a capability, with a forged one, and for an unreviewed pack', async () => {
    const { handle, deps } = setup();
    expect((await handle(post('ask', { packId: 'bio-cell-demo', packVersion: 1, question: 'q?' }))).statusCode).toBe(401);
    expect((await handle(post('ask', { capability: { ...student, token: 'x' }, packId: 'bio-cell-demo', packVersion: 1, question: 'What?' }))).statusCode).toBe(401);
    expect((await handle(post('ask', { capability: student, packId: 'hnsw-explainer', packVersion: 1, question: 'What is HNSW?' }))).statusCode).toBe(404);
    expect(deps.callModel).not.toHaveBeenCalled();
  });

  it('issues a Transcribe URL to an instructor and never to a student', async () => {
    const { handle } = setup();
    expect((await handle(post('transcribe-url', { capability: student }))).statusCode).toBe(403);
    const result = await handle(post('transcribe-url', { capability: instructor }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({ sampleRate: 16000, expiresIn: 300 });
    expect(JSON.parse(result.body).url).toMatch(/^wss:\/\/transcribestreaming\.us-east-1\.amazonaws\.com:8443\/stream-transcription-websocket\?/);
  });

  it('speaks reviewed text only, caching repeated requests', async () => {
    const { handle, deps } = setup();
    const body = { capability: student, packId: 'bio-cell-demo', packVersion: 1, assetId: 'cell-slide-03', regionId: 'mitochondrion', field: 'shortDescription' };
    const first = await handle(post('speak', body));
    await handle(post('speak', body));
    expect(first.statusCode).toBe(200);
    expect(JSON.parse(first.body)).toEqual({ contentType: 'audio/mpeg', audio: 'AQID' });
    expect(deps.synthesize).toHaveBeenCalledTimes(1);
    expect((await handle(post('speak', { ...body, field: 'text', text: 'Say anything' }))).statusCode).toBe(404);
  });

  it('transcribes an instructor clip with Whisper, never a student one, and says when Whisper is not deployed', async () => {
    const invokeWhisper = vi.fn(async () => ({ text: 'The mitochondrion releases energy.' }));
    const { handle } = setup({ invokeWhisper });
    const audio = Buffer.from(wav(2)).toString('base64');
    expect((await handle(post('transcribe-chunk', { capability: student, audio }))).statusCode).toBe(403);
    const result = await handle(post('transcribe-chunk', { capability: instructor, audio }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ text: 'The mitochondrion releases energy.' });
    expect((await handle(post('transcribe-chunk', { capability: instructor, audio: 'not base64!' }))).statusCode).toBe(400);
    expect((await handle(post('transcribe-chunk', { capability: instructor, audio: Buffer.from(wav(0.1)).toString('base64') }))).statusCode).toBe(400);

    const { handle: withoutEndpoint } = setup();
    const missing = await withoutEndpoint(post('transcribe-chunk', { capability: instructor, audio }));
    expect(missing.statusCode).toBe(503);
    expect(JSON.parse(missing.body)).toEqual({ error: 'whisper-unavailable' });
  });

  it('does not log clip text', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line: string) => { lines.push(line); });
    const { handle } = setup({ invokeWhisper: async () => ({ text: 'secret lecture words' }) });
    await handle(post('transcribe-chunk', { capability: instructor, audio: Buffer.from(wav(1)).toString('base64') }));
    spy.mockRestore();
    expect(lines.join('\n')).toContain('transcribe-chunk');
    expect(lines.join('\n')).not.toContain('secret lecture words');
  });

  it('rejects unknown routes, non-POST methods, bad bodies, and oversized bodies', async () => {
    const { handle } = setup();
    expect((await handle({ rawPath: '/admin', requestContext: { http: { method: 'POST' } }, body: '{}' })).statusCode).toBe(404);
    expect((await handle({ rawPath: '/ask', requestContext: { http: { method: 'GET' } } })).statusCode).toBe(404);
    expect((await handle({ rawPath: '/ask', requestContext: { http: { method: 'POST' } }, body: 'not json' })).statusCode).toBe(400);
    expect((await handle(post('ask', { capability: student, question: 'x'.repeat(5000) }))).statusCode).toBe(400);
  });

  it('rate-limits one session per route per minute', async () => {
    const { handle } = setup();
    const body = { capability: instructor };
    const codes: number[] = [];
    for (let i = 0; i <= RATE_LIMIT_PER_MINUTE['transcribe-url']; i++) codes.push((await handle(post('transcribe-url', body))).statusCode);
    expect(codes.slice(0, -1).every(code => code === 200)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });

  it('does not log questions, answers, or reviewed text', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line: string) => { lines.push(line); });
    const { handle } = setup();
    await handle(post('ask', { capability: student, packId: 'bio-cell-demo', packVersion: 1, question: 'What does the mitochondrion do?' }));
    spy.mockRestore();
    const logged = lines.join('\n');
    expect(logged).not.toContain('mitochondrion do');
    expect(logged).not.toContain('powers the cell');
  });
});
