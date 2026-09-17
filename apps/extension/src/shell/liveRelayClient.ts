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
  /** Real socket connectivity (`WebSocketSessionClient` only -- the mock
   *  transports never disconnect, so they have no such method). Additive to
   *  the frozen `SessionClient` interface, not part of it. */
  onConnectionChange?(listener: (connected: boolean) => void): () => void;
}

/** `SessionClient` plus the same optional, additive connection-status hook.
 *  A consumer checks for it (`'onConnectionChange' in client`) rather than
 *  assuming every transport has one. */
export interface LiveRelaySessionClient extends SessionClient {
  onConnectionChange?(listener: (connected: boolean) => void): () => void;
  /** A received relay payload did not satisfy the checked-in LiveEvent schema.
   * The hook deliberately carries no raw payload or parse detail, so a malformed
   * event cannot become an accidental content or telemetry channel. */
  onInvalidEvent?(listener: () => void): () => void;
}

/**
 * Validates everything crossing the network boundary against Part 1's own
 * schemas before the rest of the extension ever sees it. "Validation is the
 * relay's job and Part 1's schema is the client's" (the WebSocket client's
 * own docstring) -- this is where that job happens. A malformed event is
 * dropped, not forwarded or thrown; a malformed capability rejects the
 * `create`/`join` promise, since the caller is already awaiting it.
 *
 * Given a factory rather than an instance, a closed client is replaced by a
 * fresh one on the next `create` or `join`, with every subscriber moved over.
 * The shell holds one client for the page, and ending a session closes it
 * (switching packs ends the open session), so without this the next Start
 * failed until the page was reloaded.
 */
export function wrapLiveRelayClient(source: UnvalidatedSessionClient | (() => UnvalidatedSessionClient)): LiveRelaySessionClient {
  const reopen = typeof source === 'function' ? source : undefined;
  let underlying = typeof source === 'function' ? source() : source;
  let closed = false;
  const invalidEventListeners = new Set<() => void>();
  /** Each subscriber, with its unsubscribe from the current underlying client. */
  const eventListeners = new Map<(raw: unknown) => void, () => void>();
  const connectionListeners = new Map<(connected: boolean) => void, () => void>();
  const noop = () => {};

  function reopenIfClosed(): void {
    if (!closed || !reopen) return;
    underlying = reopen();
    closed = false;
    for (const listener of eventListeners.keys()) eventListeners.set(listener, underlying.subscribe(listener));
    for (const listener of connectionListeners.keys()) connectionListeners.set(listener, underlying.onConnectionChange?.(listener) ?? noop);
  }

  return {
    async create(sessionId: string): Promise<RoleCapability> {
      reopenIfClosed();
      return RoleCapabilitySchema.parse(await underlying.create(sessionId));
    },
    async join(sessionId: string): Promise<RoleCapability> {
      reopenIfClosed();
      return RoleCapabilitySchema.parse(await underlying.join(sessionId));
    },
    send(event: LiveEvent): void {
      underlying.send(event);
    },
    subscribe(listener: (event: LiveEvent) => void): () => void {
      const forward = (raw: unknown) => {
        const parsed = LiveEventSchema.safeParse(raw);
        if (parsed.success) listener(parsed.data);
        else invalidEventListeners.forEach(notify => notify());
      };
      eventListeners.set(forward, closed ? noop : underlying.subscribe(forward));
      return () => {
        eventListeners.get(forward)?.();
        eventListeners.delete(forward);
      };
    },
    close(): void {
      underlying.close();
      closed = true;
    },
    onConnectionChange: underlying.onConnectionChange
      ? (listener: (connected: boolean) => void) => {
          connectionListeners.set(listener, closed ? noop : underlying.onConnectionChange?.(listener) ?? noop);
          return () => {
            connectionListeners.get(listener)?.();
            connectionListeners.delete(listener);
          };
        }
      : undefined,
    onInvalidEvent(listener: () => void): () => void {
      invalidEventListeners.add(listener);
      return () => invalidEventListeners.delete(listener);
    },
  };
}
