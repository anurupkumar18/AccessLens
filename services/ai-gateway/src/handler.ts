/**
 * API Gateway HTTP API adapter for the AccessLens AI routes. Thin by design,
 * like the relay's handler: decisions live in the modules, which tests reach
 * with fakes; this file translates HTTP and wires the real AWS clients.
 *
 *   POST /ask             any session role   grounded answer from reviewed packs (Bedrock)
 *   POST /speak           any session role   reviewed region text as speech (Polly)
 *   POST /transcribe-url  instructor only    presigned Transcribe streaming URL
 */
import { answerQuestion, RESPOND_TOOL, type ModelCall } from './ask.js';
import { authorize } from './auth.js';
import { log } from './log.js';
import { reviewedPack } from './packs.js';
import { reviewedText } from './speak.js';
import { presignTranscribeUrl, TRANSCRIBE_SAMPLE_RATE, TRANSCRIBE_URL_TTL_SECONDS, type Presigner } from './transcribe.js';

export interface HttpEvent {
  rawPath?: string;
  requestContext?: { http?: { method?: string; path?: string } };
  body?: string | null;
  isBase64Encoded?: boolean;
}

export interface HttpResult { statusCode: number; headers: Record<string, string>; body: string }

export interface Deps {
  secret: string;
  region: string;
  callModel: ModelCall;
  synthesize(text: string): Promise<Uint8Array>;
  signer: Presigner;
  now(): Date;
}

/** Requests a single session may make per route per minute, per warm container. A cost guard, not a security boundary. */
export const RATE_LIMIT_PER_MINUTE = { ask: 20, speak: 60, 'transcribe-url': 10 } as const;
const MAX_BODY_BYTES = 4096;

const respond = (statusCode: number, payload: unknown): HttpResult => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(payload),
});

function parseBody(event: HttpEvent): Record<string, unknown> | null {
  if (!event.body) return null;
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function createHandler(deps: Deps): (event: HttpEvent) => Promise<HttpResult> {
  const windows = new Map<string, { start: number; count: number }>();
  const speechCache = new Map<string, string>();

  function limited(route: keyof typeof RATE_LIMIT_PER_MINUTE, sessionId: string): boolean {
    const key = `${route}:${sessionId}`;
    const now = deps.now().getTime();
    const window = windows.get(key);
    if (!window || now - window.start >= 60_000) {
      windows.set(key, { start: now, count: 1 });
      return false;
    }
    window.count += 1;
    return window.count > RATE_LIMIT_PER_MINUTE[route];
  }

  return async function handle(event) {
    const started = Date.now();
    const method = event.requestContext?.http?.method ?? 'GET';
    const route = (event.rawPath ?? event.requestContext?.http?.path ?? '').replace(/^\/+/, '').replace(/^[^/]+\/(?=ask$|speak$|transcribe-url$)/, '');
    if (method !== 'POST' || !(route in RATE_LIMIT_PER_MINUTE)) return respond(404, { error: 'not-found' });
    const name = route as keyof typeof RATE_LIMIT_PER_MINUTE;

    const body = parseBody(event);
    if (!body) return respond(400, { error: 'body-invalid' });

    const auth = authorize(body.capability, deps.secret, name === 'transcribe-url' ? ['instructor'] : ['instructor', 'student'], deps.now());
    if (!auth.ok) {
      log('warn', 'refused', { route: name, status: auth.status, reason: auth.reason });
      return respond(auth.status, { error: auth.reason });
    }
    if (limited(name, auth.sessionId)) return respond(429, { error: 'rate-limited' });

    if (name === 'transcribe-url') {
      const url = await presignTranscribeUrl(deps.signer, deps.region, deps.now());
      log('info', 'transcribe-url issued', { route: name, role: auth.role, durationMs: Date.now() - started });
      return respond(200, { url, sampleRate: TRANSCRIBE_SAMPLE_RATE, expiresIn: TRANSCRIBE_URL_TTL_SECONDS });
    }

    const pack = reviewedPack(body.packId, body.packVersion);
    if (!pack) return respond(404, { error: 'pack-not-reviewed' });

    if (name === 'ask') {
      const result = await answerQuestion(body.question, pack, deps.callModel);
      log('info', 'ask', {
        route: name, role: auth.role, packId: pack.packId, status: result.status,
        reason: result.status === 'declined' ? result.reason : undefined,
        cited: result.status === 'answered' ? result.citations.length : 0,
        durationMs: Date.now() - started,
      });
      return respond(200, result);
    }

    const text = reviewedText(pack, body.assetId, body.regionId, body.field);
    if (!text) return respond(404, { error: 'region-not-in-pack' });
    try {
      let audio = speechCache.get(text);
      if (!audio) {
        audio = Buffer.from(await deps.synthesize(text)).toString('base64');
        speechCache.set(text, audio);
      }
      log('info', 'speak', { route: name, role: auth.role, packId: pack.packId, durationMs: Date.now() - started });
      return respond(200, { contentType: 'audio/mpeg', audio });
    } catch {
      log('error', 'speak failed', { route: name, packId: pack.packId });
      return respond(503, { error: 'speech-unavailable' });
    }
  };
}

let handleWithAws: ((event: HttpEvent) => Promise<HttpResult>) | undefined;

/** Lambda entry point. AWS clients are created once per container, on first use. */
export async function handler(event: HttpEvent): Promise<HttpResult> {
  if (!handleWithAws) {
    const [{ AnthropicBedrock }, { PollyClient, SynthesizeSpeechCommand }, { SignatureV4 }, { Sha256 }, { defaultProvider }] = await Promise.all([
      import('@anthropic-ai/bedrock-sdk'),
      import('@aws-sdk/client-polly'),
      import('@smithy/signature-v4'),
      import('@aws-crypto/sha256-js'),
      import('@aws-sdk/credential-provider-node'),
    ]);
    const secret = process.env.CAPABILITY_SECRET;
    if (!secret) throw new Error('missing required environment variable: CAPABILITY_SECRET');
    const region = process.env.AWS_REGION ?? 'us-east-1';
    const model = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';
    const bedrock = new AnthropicBedrock({ awsRegion: region });
    const polly = new PollyClient({ region });

    handleWithAws = createHandler({
      secret,
      region,
      now: () => new Date(),
      async callModel({ system, user }) {
        const response = await bedrock.messages.create({
          model,
          max_tokens: 1024,
          system,
          messages: [{ role: 'user', content: user }],
          tools: [{ ...RESPOND_TOOL, strict: true } as typeof RESPOND_TOOL],
          tool_choice: { type: 'tool', name: RESPOND_TOOL.name },
        });
        if (response.stop_reason === 'refusal') return null;
        const call = response.content.find(block => block.type === 'tool_use');
        return call && call.type === 'tool_use' ? call.input : null;
      },
      async synthesize(text) {
        const result = await polly.send(new SynthesizeSpeechCommand({ Engine: 'neural', OutputFormat: 'mp3', VoiceId: 'Joanna', Text: text, TextType: 'text' }));
        if (!result.AudioStream) throw new Error('Polly returned no audio');
        return result.AudioStream.transformToByteArray();
      },
      signer: new SignatureV4({ credentials: defaultProvider(), region, service: 'transcribe', sha256: Sha256 }),
    });
  }
  return handleWithAws(event);
}
