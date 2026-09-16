/**
 * The real transport behind Part 1's `SessionClient` interface.
 *
 * `PARALLEL_WORKSTREAMS.md`: "Part 4 replaces the mock transport behind
 * `SessionClient`; Parts 2 and 3 must not import AWS code directly." So this
 * file contains no AWS SDK import -- it speaks the WebSocket protocol and
 * nothing else. Parts 2 and 3 keep importing the interface from
 * `apps/extension/src/shared/contracts`, and swapping `InMemorySessionClient`
 * for this one is a single construction-site change.
 *
 * The interface is deliberately not widened. `create`, `join`, `send`,
 * `subscribe`, `close` -- the five operations the contract freeze named. Two
 * behaviours that the real network forces on us are handled *inside* those five
 * rather than by adding a sixth:
 *
 *   - **Sending before the socket is open.** `send` is synchronous and returns
 *     void in the frozen interface, so it cannot wait. Events are queued and
 *     flushed on open. Dropping them instead would make the first slide change
 *     after a reconnect vanish.
 *   - **Reconnecting.** The client reconnects with backoff and presents its
 *     stored capability, so the relay can restore its role and catch it up with
 *     latest state. Subscribers see the catch-up event arrive like any other;
 *     that is what makes reconnect invisible to Part 3.
 */

export type Role = 'instructor' | 'student';

export interface RoleCapability {
  schemaVersion: '1.0';
  sessionId: string;
  role: Role;
  issuedAt: string;
  expiresAt: string;
  token: string;
}

/** Structurally identical to Part 1's `LiveEvent`; kept local so this package
 *  does not reach into the extension's source tree. */
export type LiveEvent = Record<string, unknown>;

export interface SessionClient {
  create(sessionId: string): Promise<RoleCapability>;
  join(sessionId: string): Promise<RoleCapability>;
  send(event: LiveEvent): void;
  subscribe(listener: (event: LiveEvent) => void): () => void;
  close(): void;
}

type SocketLike = Pick<WebSocket, 'send' | 'close' | 'readyState'> & {
  onopen: ((this: WebSocket, ev: Event) => unknown) | null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null;
};

export interface WebSocketSessionClientOptions {
  url: string;
  /** Injected for tests; defaults to the platform `WebSocket`. */
  socketFactory?: (url: string) => SocketLike;
  /** Reconnect backoff, in milliseconds. Exhausting the list stops retrying. */
  backoffMs?: number[];
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  /** How long to wait for the relay to answer create/join. */
  requestTimeoutMs?: number;
}

const DEFAULT_BACKOFF = [250, 500, 1000, 2000, 5000];

export class WebSocketSessionClient implements SessionClient {
  private socket?: SocketLike;
  private readonly listeners = new Set<(event: LiveEvent) => void>();
  private readonly outbox: LiveEvent[] = [];
  private pending?: { resolve: (c: RoleCapability) => void; reject: (e: Error) => void };
  private capability?: RoleCapability;
  private sessionId?: string;
  private closed = false;
  private attempt = 0;

  constructor(private readonly options: WebSocketSessionClientOptions) {}

  create(sessionId: string): Promise<RoleCapability> {
    return this.handshake(sessionId, { kind: 'create', sessionId });
  }

  join(sessionId: string): Promise<RoleCapability> {
    return this.handshake(sessionId, { kind: 'join', sessionId, role: 'student' });
  }

  send(event: LiveEvent): void {
    if (this.closed) throw new Error('SessionClient is closed');
    this.outbox.push(event);
    this.flush();
  }

  subscribe(listener: (event: LiveEvent) => void): () => void {
    if (this.closed) throw new Error('SessionClient is closed');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.sessionId && this.socket?.readyState === 1) {
      // Best effort: tell the relay, so students stop immediately rather than
      // waiting for a TTL. A failure here is not worth surfacing -- the session
      // expires regardless.
      try {
        this.socket.send(JSON.stringify({ kind: 'close', sessionId: this.sessionId }));
      } catch {
        /* the socket is going away anyway */
      }
    }
    this.listeners.clear();
    this.outbox.length = 0;
    this.socket?.close();
    this.socket = undefined;
  }

  private handshake(sessionId: string, message: Record<string, unknown>): Promise<RoleCapability> {
    if (this.closed) return Promise.reject(new Error('SessionClient is closed'));
    this.sessionId = sessionId;
    return new Promise<RoleCapability>((resolve, reject) => {
      this.pending = { resolve, reject };
      this.connect(() => this.socket?.send(JSON.stringify(message)));

      const timeout = this.options.requestTimeoutMs ?? 10_000;
      const schedule = this.options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
      schedule(() => {
        if (this.pending) {
          this.pending.reject(new Error('relay did not answer in time'));
          this.pending = undefined;
        }
      }, timeout);
    });
  }

  private url(): string {
    // A reconnecting client presents its capability so the relay can restore
    // the role of a connection it has never seen. `SessionMessageSchema` is
    // strict, so this cannot ride on a message.
    if (!this.capability || !this.sessionId) return this.options.url;
    const encoded = base64Url(JSON.stringify(this.capability));
    const separator = this.options.url.includes('?') ? '&' : '?';
    return `${this.options.url}${separator}sessionId=${encodeURIComponent(
      this.sessionId,
    )}&capability=${encoded}`;
  }

  private connect(onOpen?: () => void): void {
    if (this.closed) return;
    if (this.socket && this.socket.readyState <= 1) {
      if (this.socket.readyState === 1) onOpen?.();
      return;
    }

    const factory =
      this.options.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
    const socket = factory(this.url());
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      onOpen?.();
      this.flush();
    };

    socket.onmessage = event => {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(String((event as MessageEvent).data));
      } catch {
        return;
      }
      this.receive(payload);
    };

    socket.onclose = () => {
      this.socket = undefined;
      if (!this.closed) this.scheduleReconnect();
    };

    socket.onerror = () => {
      /* onclose follows; reconnect is handled there */
    };
  }

  private receive(payload: Record<string, unknown>): void {
    switch (payload.kind) {
      case 'capability': {
        this.capability = payload.capability as RoleCapability;
        this.pending?.resolve(this.capability);
        this.pending = undefined;
        return;
      }
      case 'event': {
        // Delivery only. Validation is the relay's job and Part 1's schema is
        // the client's; this transport does not get an opinion, so it cannot
        // become a third, quietly different validator.
        const event = payload.event as LiveEvent;
        this.listeners.forEach(listener => listener(event));
        return;
      }
      case 'error': {
        this.pending?.reject(new Error(String(payload.reason ?? 'relay-error')));
        this.pending = undefined;
        return;
      }
      default:
        return;
    }
  }

  private scheduleReconnect(): void {
    const backoff = this.options.backoffMs ?? DEFAULT_BACKOFF;
    const delay = backoff[Math.min(this.attempt, backoff.length - 1)];
    if (delay === undefined || this.attempt >= backoff.length) return;
    this.attempt += 1;
    const schedule = this.options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
    schedule(() => this.connect(), delay);
  }

  private flush(): void {
    if (!this.socket || this.socket.readyState !== 1) {
      this.connect();
      return;
    }
    while (this.outbox.length > 0) {
      const event = this.outbox[0]!;
      try {
        this.socket.send(JSON.stringify({ kind: 'event', event }));
      } catch {
        return; // leave it queued for the next open
      }
      this.outbox.shift();
    }
  }
}

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : // Node before a DOM shim; Buffer is present there.
        (globalThis as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } })
          .Buffer!.from(value, 'utf8')
          .toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
