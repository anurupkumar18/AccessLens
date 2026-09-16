import { describe, expect, it, vi } from 'vitest';
import { AiUnavailableError, createAiClient, isRelayCapability } from './aiClient';
import type { RoleCapability } from './contracts';

const capability: RoleCapability = { schemaVersion: '1.0', sessionId: 'S1', role: 'student', issuedAt: '2026-09-16T18:00:00.000Z', expiresAt: '2026-09-16T22:00:00.000Z', token: 'signed' };
const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('aiClient', () => {
  it('posts the capability and question to /ask and returns a validated answer', async () => {
    const fetchImpl = reply(200, { status: 'answered', answer: 'It powers the cell.', citations: [{ assetId: 'a', assetTitle: 'A', regionId: 'r', label: 'R' }] });
    const client = createAiClient('https://ai.example/', fetchImpl as unknown as typeof fetch);
    await expect(client.ask(capability, 'bio-cell-demo', 1, 'What?')).resolves.toMatchObject({ status: 'answered' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ai.example/ask');
    expect(JSON.parse(init.body as string)).toEqual({ capability, packId: 'bio-cell-demo', packVersion: 1, question: 'What?' });
  });

  it('rejects an answer with no citations as an unexpected response', async () => {
    const client = createAiClient('https://ai.example', reply(200, { status: 'answered', answer: 'Trust me.', citations: [] }) as unknown as typeof fetch);
    await expect(client.ask(capability, 'p', 1, 'q?')).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('surfaces HTTP errors with their status', async () => {
    const client = createAiClient('https://ai.example', reply(404, { error: 'pack-not-reviewed' }) as unknown as typeof fetch);
    await expect(client.ask(capability, 'p', 1, 'q?')).rejects.toMatchObject({ status: 404 });
  });

  it('decodes Polly audio into an mp3 blob and requires a wss Transcribe URL', async () => {
    const speak = createAiClient('https://ai.example', reply(200, { contentType: 'audio/mpeg', audio: 'AQID' }) as unknown as typeof fetch);
    const blob = await speak.speak(capability, 'p', 1, 'a', 'r', 'shortDescription');
    expect(blob.type).toBe('audio/mpeg');
    expect(blob.size).toBe(3);
    const bad = createAiClient('https://ai.example', reply(200, { url: 'https://nope', sampleRate: 16000, expiresIn: 300 }) as unknown as typeof fetch);
    await expect(bad.transcribeUrl(capability)).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('treats mock-transport capabilities as not signed by the relay', () => {
    expect(isRelayCapability(capability)).toBe(true);
    expect(isRelayCapability({ ...capability, token: 'mock-student-S1' })).toBe(false);
    expect(isRelayCapability(null)).toBe(false);
  });
});
