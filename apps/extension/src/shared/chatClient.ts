import { z } from 'zod';
import type { RoleCapability } from './contracts';

/**
 * Client for the study chat (services/ai-gateway/src/chatHandler.ts). The
 * reply streams as newline-delimited JSON events, each validated before the
 * UI sees it. Like the other AI calls, every request carries the relay-signed
 * capability and no AWS credential; the conversation itself lives only in the
 * student's page.
 */

const SourceRef = z.object({ id: z.string(), title: z.string(), source: z.string().optional() });
const ChatEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({ type: z.literal('sources'), sources: z.array(SourceRef) }),
  z.object({ type: z.literal('done'), stop: z.enum(['end_turn', 'max_tokens', 'guardrail', 'content_filtered', 'search_limit']) }),
  z.object({ type: z.literal('error'), reason: z.string() }),
]);

export type ChatEvent = z.infer<typeof ChatEventSchema>;
export type ChatSource = z.infer<typeof SourceRef>;
export type ChatStop = Extract<ChatEvent, { type: 'done' }>['stop'];

export interface ChatTurn { role: 'student' | 'assistant'; text: string }

export interface ChatRequest {
  capability: RoleCapability;
  packId: string;
  packVersion: number;
  /** The slide the student is following, so the chat knows what "this" means. */
  assetId?: string;
  regionId?: string;
  turns: ChatTurn[];
}

export class ChatUnavailableError extends Error {
  constructor(readonly status: number | null, readonly reason: string) { super(`Study chat unavailable: ${reason}`); }
}

export interface ChatClient {
  /** Streams one reply. Resolves when it ends; an aborted request resolves quietly. */
  send(request: ChatRequest, onEvent: (event: ChatEvent) => void, signal?: AbortSignal): Promise<void>;
}

export function createChatClient(url: string, fetchImpl: typeof fetch = (...args) => fetch(...args)): ChatClient {
  return {
    async send(request, onEvent, signal) {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
          signal,
        });
      } catch {
        if (signal?.aborted) return;
        throw new ChatUnavailableError(null, 'unreachable');
      }
      if (!response.ok || !response.body) {
        const first = parse((await response.text().catch(() => '')).split('\n')[0] ?? '');
        throw new ChatUnavailableError(response.status, first?.type === 'error' ? first.reason : `http-${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          let newline = buffer.indexOf('\n');
          while (newline >= 0) {
            const event = parse(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
            if (event) onEvent(event);
            newline = buffer.indexOf('\n');
          }
          if (done) break;
        }
        const last = parse(buffer);
        if (last) onEvent(last);
      } catch {
        if (signal?.aborted) return;
        throw new ChatUnavailableError(response.status, 'interrupted');
      }
    },
  };
}

function parse(line: string): ChatEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const result = ChatEventSchema.safeParse(JSON.parse(trimmed));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** The configured client, or null when VITE_ACCESSLENS_CHAT_URL is unset. */
export const defaultChatClient: ChatClient | null = import.meta.env.VITE_ACCESSLENS_CHAT_URL
  ? createChatClient(import.meta.env.VITE_ACCESSLENS_CHAT_URL)
  : null;
