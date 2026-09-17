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
 *     stored capability, so the relay can restore its role, and a student joins
 *     again to be caught up with latest state. Subscribers see the catch-up
 *     event arrive like any other; that is what makes reconnect invisible to
 *     Part 3. It keeps retrying for `retryForMs`, and a browser `online` event
 *     starts a fresh round.
 *   - **Closing.** `close` waits briefly for the relay to acknowledge events
 *     still in flight, so a final `session.ended` is not refused by the close
 *     that follows it.
 */

export type Role = 'instructor' | 'student';

export interface RoleCapability {
  schemaVersion: '1.0';
  sessionId: string;
  role: Role;
  issuedAt: string;
  expiresAt: string;
  token: string;
  /** Video stage token, when the session has video. Opaque here. */
  streamToken?: string;
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
  /** Reconnect backoff, in milliseconds. The last delay repeats while retrying. */
  backoffMs?: number[];
  /** How long to keep retrying a lost connection before giving up. */
  retryForMs?: number;
  /** How long `close` waits for in-flight events to be acknowledged. */
  closeGraceMs?: number;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  now?: () => number;
  /** Source of the browser's `online` event; defaults to the global scope when it has one. */
  networkEvents?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  /** How long to wait for the relay to answer create/join. */
  requestTimeoutMs?: number;
}

const DEFAULT_BACKOFF = [250, 500, 1000, 2000, 5000];
const DEFAULT_RETRY_FOR_MS = 2 * 60 * 1000;
const DEFAULT_CLOSE_GRACE_MS = 2000;

export class WebSocketSessionClient implements SessionClient {
  private socket?: SocketLike;
  private readonly listeners = new Set<(event: LiveEvent) => void>();
  private readonly connectionListeners = new Set<(connected: boolean) => void>();
  private readonly outbox: LiveEvent[] = [];
  private pending?: { resolve: (c: RoleCapability) => void; reject: (e: Error) => void };
  private capability?: RoleCapability;
  private sessionId?: string;
  private closed = false;
  private attempt = 0;
  /** When the current run of failed connections began; unset while connected. */
  private failingSince?: number;
  /** Set when an open connection drops, so the next open knows it is a reconnect. */
  private dropped = false;
  /** Events sent on the socket that the relay has not yet accepted or rejected. */
  private inFlight = 0;
  private finishClose?: () => void;
  private readonly networkEvents?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  private readonly onOnline = () => {
    if (this.closed || this.socket || !this.sessionId) return;
    this.attempt = 0;
    this.failingSince = undefined;
    this.connect();
  };

  constructor(private readonly options: WebSocketSessionClientOptions) {
    const scope = globalThis as Partial<Pick<EventTarget, 'addEventListener' | 'removeEventListener'>>;
    this.networkEvents =
      options.networkEvents ??
      (typeof scope.addEventListener === 'function' ? (scope as EventTarget) : undefined);
    this.networkEvents?.addEventListener('online', this.onOnline);
  }

  /**
   * Real socket connectivity, not a proxy for it. `SessionClient`'s frozen
   * five methods have no room for this, so it is additive rather than a
   * change to that interface -- existing callers (Parts 2 and 3's code
   * against the mock/BroadcastChannel clients, which never disconnect) are
   * unaffected. A consumer that wants genuine staleness rather than a
   * content-silence guess checks for this method before using it.
   */
  onConnectionChange(listener: (connected: boolean) => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  private notifyConnection(connected: boolean): void {
    this.connectionListeners.forEach(listener => listener(connected));
  }

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
    this.networkEvents?.removeEventListener('online', this.onOnline);
    this.listeners.clear();
    const socket = this.socket;
    if (socket?.readyState === 1) this.flush();
    this.outbox.length = 0;

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      this.finishClose = undefined;
      if (this.sessionId && socket?.readyState === 1) {
        // Best effort: tell the relay, so students stop immediately rather than
        // waiting for a TTL. A failure here is not worth surfacing -- the session
        // expires regardless.
        try {
          socket.send(JSON.stringify({ kind: 'close', sessionId: this.sessionId }));
        } catch {
          /* the socket is going away anyway */
        }
      }
      socket?.close();
      if (this.socket === socket) this.socket = undefined;
    };

    if (socket?.readyState !== 1 || this.inFlight === 0) {
      finish();
      return;
    }
    // The relay handles each message on its own, so a close sent in the same
    // instant as the last event can land first and get that event refused --
    // and the last event is usually `session.ended`, the one students most need.
    this.finishClose = finish;
    const schedule = this.options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
    schedule(finish, this.options.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS);
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
    // The stage token is for the video service, not the relay, and is the one
    // field long enough to matter in a URL; the relay resumes without it.
    const { streamToken: _omitted, ...presented } = this.capability;
    const encoded = base64Url(JSON.stringify(presented));
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
      const reconnected = this.dropped;
      this.dropped = false;
      this.attempt = 0;
      this.failingSince = undefined;
      this.notifyConnection(true);
      onOpen?.();
      if (reconnected && this.capability?.role === 'student' && this.sessionId && !this.pending) {
        // The relay's resume posts its catch-up during `$connect`, before API
        // Gateway can deliver to the connection, so it never arrives. Joining
        // again is the frozen protocol's way to ask for the latest view.
        try {
          socket.send(JSON.stringify({ kind: 'join', sessionId: this.sessionId, role: 'student' }));
        } catch {
          /* onclose follows and retries */
        }
      }
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
      if (this.socket === socket) this.socket = undefined;
      this.dropped = true;
      this.inFlight = 0;
      this.notifyConnection(false);
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
      case 'accepted':
      case 'rejected': {
        this.acknowledge();
        return;
      }
      case 'error': {
        if (!this.pending) {
          this.acknowledge();
          return;
        }
        this.pending.reject(new Error(String(payload.reason ?? 'relay-error')));
        this.pending = undefined;
        return;
      }
      default:
        return;
    }
  }

  private acknowledge(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (this.inFlight === 0) this.finishClose?.();
  }

  private scheduleReconnect(): void {
    const now = this.options.now?.() ?? Date.now();
    this.failingSince ??= now;
    if (now - this.failingSince > (this.options.retryForMs ?? DEFAULT_RETRY_FOR_MS)) return;
    // An expired capability cannot resume, so retrying would only be refused.
    if (this.capability && Date.parse(this.capability.expiresAt) <= now) return;
    const backoff = this.options.backoffMs ?? DEFAULT_BACKOFF;
    const delay = backoff[Math.min(this.attempt, backoff.length - 1)];
    if (delay === undefined) return;
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
      this.inFlight += 1;
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
