/**
 * Lambda entry for the study chat, behind a Function URL in RESPONSE_STREAM
 * mode so the reply reaches the student as it is written (API Gateway's HTTP
 * API buffers responses, which is why this is not a route on the gateway).
 *
 *   POST {capability, packId, packVersion, assetId?, regionId?, turns: [{role, text}]}
 *   -> 200 application/x-ndjson, one ChatEvent per line, ending with `done` or `error`
 *   -> 400 / 401 / 403 / 404 / 429 as a single JSON line before any streaming
 *
 * Same boundary as the other AI routes: only someone holding a relay-signed
 * role capability for a live session can chat, per-session rate limits bound
 * cost, and nothing the student wrote is logged.
 */
import { authorize } from './auth.js';
import { readTurns, runChat, type ChatDeps, type ChatEvent, type ConverseStreamEvent } from './chat.js';
import { bedrockKnowledgeBase } from './knowledge.js';
import { log } from './log.js';
import { createPackLoader, reviewedPack, type ReviewedPack } from './packs.js';

export const CHAT_MESSAGES_PER_MINUTE = 20;
const MAX_BODY_BYTES = 64_000;

export interface ChatRequestEvent {
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext?: { http?: { method?: string } };
}

/** Where a response goes: status and headers once, then lines of body. */
export interface ChatResponse {
  start(statusCode: number): void;
  write(line: string): void;
  end(): void;
}

export interface ChatHandlerDeps {
  secret: string;
  now(): Date;
  chat: ChatDeps;
  /** Reviewed packs the chat may use; defaults to the bundled ones only. */
  loadPack?: (packId: unknown, version: unknown) => Promise<ReviewedPack | null>;
}

export function createChatHandler(deps: ChatHandlerDeps): (event: ChatRequestEvent, response: ChatResponse) => Promise<void> {
  const windows = new Map<string, { start: number; count: number }>();
  const refuse = (response: ChatResponse, status: number, error: string) => {
    response.start(status);
    response.write(`${JSON.stringify({ type: 'error', reason: error })}\n`);
    response.end();
  };

  return async function handle(event, response) {
    const started = Date.now();
    if ((event.requestContext?.http?.method ?? 'POST') !== 'POST') return refuse(response, 404, 'not-found');
    const raw = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : '';
    if (!raw || Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return refuse(response, 400, 'body-invalid');
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return refuse(response, 400, 'body-invalid');
      body = parsed as Record<string, unknown>;
    } catch {
      return refuse(response, 400, 'body-invalid');
    }

    const auth = authorize(body.capability, deps.secret, ['student', 'instructor'], deps.now());
    if (!auth.ok) {
      log('warn', 'refused', { route: 'chat', status: auth.status, reason: auth.reason });
      return refuse(response, auth.status, auth.reason);
    }
    const now = deps.now().getTime();
    const window = windows.get(auth.sessionId);
    if (!window || now - window.start >= 60_000) windows.set(auth.sessionId, { start: now, count: 1 });
    else if (++window.count > CHAT_MESSAGES_PER_MINUTE) return refuse(response, 429, 'rate-limited');

    const pack = deps.loadPack ? await deps.loadPack(body.packId, body.packVersion) : reviewedPack(body.packId, body.packVersion);
    if (!pack) return refuse(response, 404, 'pack-not-reviewed');
    const turns = readTurns(body.turns);
    if (!turns) return refuse(response, 400, 'turns-invalid');
    const assetId = typeof body.assetId === 'string' ? body.assetId : undefined;
    const regionId = typeof body.regionId === 'string' ? body.regionId : undefined;

    response.start(200);
    let stop = 'error';
    let searches = 0;
    try {
      for await (const chatEvent of runChat(turns, { pack, assetId, regionId }, deps.chat)) {
        if (chatEvent.type === 'done') stop = chatEvent.stop;
        if (chatEvent.type === 'sources') searches++;
        response.write(`${JSON.stringify(chatEvent)}\n`);
      }
    } catch {
      const failure: ChatEvent = { type: 'error', reason: 'chat-unavailable' };
      response.write(`${JSON.stringify(failure)}\n`);
    }
    response.end();
    // The conversation is content (A4): only its outcome is logged.
    log(stop === 'error' ? 'error' : 'info', 'chat', { route: 'chat', role: auth.role, packId: pack.packId, reason: stop, retrieved: searches, durationMs: Date.now() - started });
  };
}

// ---- Lambda wiring ----------------------------------------------------------

interface LambdaResponseStream { write(chunk: string): void; end(): void }
declare const awslambda: {
  streamifyResponse(handler: (event: ChatRequestEvent, stream: LambdaResponseStream) => Promise<void>): unknown;
  HttpResponseStream: { from(stream: LambdaResponseStream, metadata: { statusCode: number; headers: Record<string, string> }): LambdaResponseStream };
};

let handleWithAws: ReturnType<typeof createChatHandler> | undefined;

/** The handler wired to real Bedrock clients, from environment configuration. */
export async function buildChatHandler(): Promise<ReturnType<typeof createChatHandler>> {
  const [{ BedrockRuntimeClient, ConverseStreamCommand }, { BedrockAgentRuntimeClient, RetrieveCommand }] = await Promise.all([
    import('@aws-sdk/client-bedrock-runtime'),
    import('@aws-sdk/client-bedrock-agent-runtime'),
  ]);
  const secret = process.env.CAPABILITY_SECRET;
  if (!secret) throw new Error('missing required environment variable: CAPABILITY_SECRET');
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const runtime = new BedrockRuntimeClient({ region });
  const guardrailId = process.env.GUARDRAIL_ID;
  const knowledgeBaseId = process.env.KNOWLEDGE_BASE_ID;
  const agentRuntime = knowledgeBaseId ? new BedrockAgentRuntimeClient({ region }) : undefined;
  const packBase = process.env.PACK_BASE_URL?.replace(/\/+$/, '');

  return createChatHandler({
    secret,
    now: () => new Date(),
    loadPack: createPackLoader(packBase
      ? async (packId, version) => {
        const response = await fetch(`${packBase}/packs/${encodeURIComponent(packId)}/${version}.json`);
        return response.ok ? response.json() : null;
      }
      : undefined),
    chat: {
      modelId: process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6',
      guardrail: guardrailId ? { id: guardrailId, version: process.env.GUARDRAIL_VERSION ?? 'DRAFT' } : undefined,
      knowledge: agentRuntime && knowledgeBaseId
        ? bedrockKnowledgeBase(knowledgeBaseId, input => agentRuntime.send(new RetrieveCommand(input)))
        : undefined,
      async *converse(request) {
        const output = await runtime.send(new ConverseStreamCommand(request as ConstructorParameters<typeof ConverseStreamCommand>[0]));
        // The SDK's stream members are a superset of the events runChat reads.
        if (output.stream) yield* output.stream as unknown as AsyncIterable<ConverseStreamEvent>;
      },
    },
  });
}

export const handler = typeof awslambda === 'undefined' ? undefined : awslambda.streamifyResponse(async (event, stream) => {
  handleWithAws ??= await buildChatHandler();
  let http: LambdaResponseStream | undefined;
  await handleWithAws(event, {
    start(statusCode) {
      http = awslambda.HttpResponseStream.from(stream, {
        statusCode,
        headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' },
      });
    },
    write(line) { http?.write(line); },
    end() { http?.end(); },
  });
});
