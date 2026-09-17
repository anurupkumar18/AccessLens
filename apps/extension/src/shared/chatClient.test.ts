import { describe, expect, it, vi } from 'vitest';
import { ChatUnavailableError, createChatClient, type ChatEvent, type ChatRequest } from './chatClient';

const request: ChatRequest = {
  capability: { schemaVersion: '1.0', sessionId: 'S1', role: 'student', issuedAt: '2026-09-16T18:00:00.000Z', expiresAt: '2026-09-16T22:00:00.000Z', token: 'signed' },
  packId: 'bio-cell-demo', packVersion: 1, assetId: 'cell-slide-03',
  turns: [{ role: 'student', text: 'What does the nucleus do?' }],
};

/** A streaming response whose body arrives in the given chunks. */
function streamed(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); },
  });
  return new Response(body, { status, headers: { 'content-type': 'application/x-ndjson' } });
}

describe('chatClient', () => {
  it('posts the request and hands over each streamed event, even when lines split across chunks', async () => {
    const fetchImpl = vi.fn(async () => streamed([
      '{"type":"delta","text":"The nuc',
      'leus"}\n{"type":"delta","text":" holds DNA."}\n{"type":"sour',
      'ces","sources":[{"id":"source-1","title":"Notes.pdf"}]}\nnot json\n{"type":"done","stop":"end_turn"}',
    ]));
    const events: ChatEvent[] = [];
    await createChatClient('https://chat.example/', fetchImpl as unknown as typeof fetch).send(request, event => events.push(event));
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://chat.example/');
    expect(JSON.parse(init.body as string)).toEqual(request);
    expect(events).toEqual([
      { type: 'delta', text: 'The nucleus' },
      { type: 'delta', text: ' holds DNA.' },
      { type: 'sources', sources: [{ id: 'source-1', title: 'Notes.pdf' }] },
      { type: 'done', stop: 'end_turn' },
    ]);
  });

  it('turns a refusal into an error with its status and reason', async () => {
    const client = createChatClient('https://chat.example', (async () => streamed(['{"type":"error","reason":"rate-limited"}\n'], 429)) as unknown as typeof fetch);
    await expect(client.send(request, () => undefined)).rejects.toMatchObject({ status: 429, reason: 'rate-limited' });
    const offline = createChatClient('https://chat.example', (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch);
    await expect(offline.send(request, () => undefined)).rejects.toBeInstanceOf(ChatUnavailableError);
  });

  it('resolves quietly when the student stops the reply', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      controller.abort();
      throw Object.assign(new Error('aborted'), { name: 'AbortError', signal: init.signal });
    });
    await expect(createChatClient('https://chat.example', fetchImpl as unknown as typeof fetch).send(request, () => undefined, controller.signal)).resolves.toBeUndefined();
  });
});
