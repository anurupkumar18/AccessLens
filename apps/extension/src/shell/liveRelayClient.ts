import { LiveEventSchema, RoleCapabilitySchema, type LiveEvent, type RoleCapability, type SessionClient } from '../shared/contracts';

/** The loosely-typed shape Part 4's `WebSocketSessionClient` actually
 *  implements (`services/live-session/src/client/webSocketSessionClient.ts`).
 *  That file deliberately types events and capabilities as `Record<string,
 *  unknown>` so it never imports Part 1's schema package; this is the other
 *  side of that boundary. */
interface UnvalidatedSessionClient {
  create(sessionId: string): Promise<unknown>;
  join(sessionId: string): Promise<unknown>;
  send(event: unknown): void;
  subscribe(listener: (event: unknown) => void): () => void;
  close(): void;
}

/**
 * Validates everything crossing the network boundary against Part 1's own
 * schemas before the rest of the extension ever sees it. "Validation is the
 * relay's job and Part 1's schema is the client's" (the WebSocket client's
 * own docstring) -- this is where that job happens. A malformed event is
 * dropped, not forwarded or thrown; a malformed capability rejects the
 * `create`/`join` promise, since the caller is already awaiting it.
 */
export function wrapLiveRelayClient(underlying: UnvalidatedSessionClient): SessionClient {
  return {
    async create(sessionId: string): Promise<RoleCapability> {
      return RoleCapabilitySchema.parse(await underlying.create(sessionId));
    },
    async join(sessionId: string): Promise<RoleCapability> {
      return RoleCapabilitySchema.parse(await underlying.join(sessionId));
    },
    send(event: LiveEvent): void {
      underlying.send(event);
    },
    subscribe(listener: (event: LiveEvent) => void): () => void {
      return underlying.subscribe(raw => {
        const parsed = LiveEventSchema.safeParse(raw);
        if (parsed.success) listener(parsed.data);
      });
    },
    close(): void {
      underlying.close();
    },
  };
}
