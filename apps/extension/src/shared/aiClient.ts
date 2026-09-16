import { z } from 'zod';
import type { RoleCapability } from './contracts';

/**
 * Client for services/ai-gateway. Every call carries the role capability the
 * relay issued, which the gateway verifies; nothing here holds an AWS
 * credential. Responses are validated before the UI sees them.
 */

const Citation = z.object({ assetId: z.string(), assetTitle: z.string(), regionId: z.string(), label: z.string() });
const AskResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('answered'), answer: z.string().min(1), citations: z.array(Citation).min(1) }),
  z.object({ status: z.literal('declined'), reason: z.string() }),
]);
const TranscribeUrl = z.object({ url: z.string().startsWith('wss://'), sampleRate: z.number().int().positive(), expiresIn: z.number().positive() });

export type AskAnswer = z.infer<typeof AskResult>;
export type TranscribeGrant = z.infer<typeof TranscribeUrl>;

export class AiUnavailableError extends Error {
  constructor(readonly status: number | null, message: string) { super(message); }
}

export interface AiClient {
  ask(capability: RoleCapability, packId: string, packVersion: number, question: string): Promise<AskAnswer>;
  transcribeUrl(capability: RoleCapability): Promise<TranscribeGrant>;
}

export function createAiClient(baseUrl: string, fetchImpl: typeof fetch = (...args) => fetch(...args), timeoutMs = 20_000): AiClient {
  const root = baseUrl.replace(/\/+$/, '');

  async function post<T>(route: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(`${root}/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new AiUnavailableError(null, 'The AI service could not be reached.');
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new AiUnavailableError(response.status, `The AI service answered ${response.status}.`);
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new AiUnavailableError(response.status, 'The AI service sent an unexpected response.');
    return parsed.data;
  }

  return {
    ask: (capability, packId, packVersion, question) => post('ask', { capability, packId, packVersion, question }, AskResult),
    transcribeUrl: capability => post('transcribe-url', { capability }, TranscribeUrl),
  };
}

/** The configured client, or null when VITE_ACCESSLENS_AI_URL is unset (features then explain themselves instead of failing). */
export const defaultAiClient: AiClient | null = import.meta.env.VITE_ACCESSLENS_AI_URL
  ? createAiClient(import.meta.env.VITE_ACCESSLENS_AI_URL)
  : null;

/** Capabilities from mock transports are not signed by the relay, so the gateway would refuse them. */
export function isRelayCapability(capability: RoleCapability | null | undefined): capability is RoleCapability {
  return Boolean(capability && !capability.token.startsWith('mock-'));
}
