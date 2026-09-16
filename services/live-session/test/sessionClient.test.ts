/**
 * Part 4's fifth "Done when": the real client replaces Part 1's mock without
 * changing Parts 2 or 3.
 *
 * That claim is only worth something if it is checked structurally rather than
 * by reading both files and deciding they look similar. The first test here
 * asserts the two classes present the same five methods with the same arities;
 * the rest exercise the behaviours a network adds that an in-memory client
 * never had to think about.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  WebSocketSessionClient,
  type RoleCapability,
} from '../src/client/webSocketSessionClient.js';

/** Minimal scriptable WebSocket. `readyState` follows the DOM constants. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  onclose: ((ev: CloseEvent) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  open() {
    this.readyState = 1;
    this.onopen?.({ type: 'open' } as Event);
  }

  deliver(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }

  drop() {
    this.readyState = 3;
    this.onclose?.({ type: 'close' } as CloseEvent);
  }

  send(data: string) {
    if (this.readyState !== 1) throw new Error('not open');
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }

  messages() {
    return this.sent.map(raw => JSON.parse(raw));
  }
}

const capability = (role: 'instructor' | 'student'): RoleCapability => ({
  schemaVersion: '1.0',
  sessionId: 'sess-demo-0001',
  role,
  issuedAt: '2026-09-15T15:00:00.000Z',
  expiresAt: '2026-09-15T19:00:00.000Z',
  token: 'signed-token',
});

function make() {
  FakeSocket.instances = [];
  const timers: (() => void)[] = [];
  const client = new WebSocketSessionClient({
    url: 'wss://relay.example/live',
    socketFactory: url => new FakeSocket(url) as never,
    setTimeoutFn: fn => timers.push(fn as () => void),
    backoffMs: [1, 1, 1],
  });
  return {
    client,
    timers,
    latest: () => FakeSocket.instances.at(-1)!,
    runTimers: () => {
      const queued = timers.splice(0);
      for (const fn of queued) fn();
    },
  };
}

describe('WebSocketSessionClient', () => {
  it('presents the same surface as Part 1 froze', async () => {
    // Imported lazily so this test file does not pull the extension's React
    // toolchain into this package's test run.
    const { InMemorySessionClient } = await import(
      '../../../apps/extension/src/shared/contracts.js'
    );
    const mock = new InMemorySessionClient();
    const real = new WebSocketSessionClient({ url: 'wss://relay.example/live' });

    for (const method of ['create', 'join', 'send', 'subscribe', 'close'] as const) {
      expect(typeof (real as never)[method], method).toBe('function');
      expect(
        ((real as never)[method] as (...a: unknown[]) => unknown).length,
        `${method} arity`,
      ).toBe(((mock as never)[method] as (...a: unknown[]) => unknown).length);
    }
  });

  it('creates a session and resolves the instructor capability', async () => {
    const h = make();
    const promise = h.client.create('sess-demo-0001');
    h.latest().open();
    expect(h.latest().messages()).toEqual([{ kind: 'create', sessionId: 'sess-demo-0001' }]);

    h.latest().deliver({ kind: 'capability', capability: capability('instructor') });
    await expect(promise).resolves.toMatchObject({ role: 'instructor' });
  });

  it('joins as a student, never as an instructor', async () => {
    const h = make();
    const promise = h.client.join('sess-demo-0001');
    h.latest().open();
    expect(h.latest().messages()[0]).toEqual({
      kind: 'join',
      sessionId: 'sess-demo-0001',
      role: 'student',
    });
    h.latest().deliver({ kind: 'capability', capability: capability('student') });
    await expect(promise).resolves.toMatchObject({ role: 'student' });
  });

  it('queues events sent before the socket opens, then flushes in order', async () => {
    const h = make();
    const promise = h.client.create('sess-demo-0001');
    h.latest().open();
    h.latest().deliver({ kind: 'capability', capability: capability('instructor') });
    await promise;

    h.latest().readyState = 0; // socket blipped, not yet closed
    h.client.send({ sequence: 1 });
    h.client.send({ sequence: 2 });
    h.latest().readyState = 1;
    h.client.send({ sequence: 3 });

    const events = h
      .latest()
      .messages()
      .filter(m => m.kind === 'event')
      .map(m => m.event.sequence);
    expect(events).toEqual([1, 2, 3]);
  });

  it('delivers relayed events to every subscriber, and stops on unsubscribe', () => {
    const h = make();
    h.client.create('sess-demo-0001').catch(() => {});
    h.latest().open();

    const seen: unknown[] = [];
    const unsubscribe = h.client.subscribe(event => seen.push(event));
    h.client.subscribe(event => seen.push(event));

    h.latest().deliver({ kind: 'event', event: { sequence: 1 } });
    expect(seen).toHaveLength(2);

    unsubscribe();
    h.latest().deliver({ kind: 'event', event: { sequence: 2 } });
    expect(seen).toHaveLength(3);
  });

  it('reconnects and presents its capability so the relay can restore its role', async () => {
    const h = make();
    const promise = h.client.create('sess-demo-0001');
    h.latest().open();
    h.latest().deliver({ kind: 'capability', capability: capability('instructor') });
    await promise;

    h.latest().drop();
    h.runTimers();

    const reconnected = h.latest();
    expect(reconnected.url).toContain('sessionId=sess-demo-0001');
    expect(reconnected.url).toContain('capability=');

    // Decodable back to the capability the relay issued -- base64url, no
    // padding, so it survives a query string.
    const encoded = new URL(reconnected.url.replace('wss://', 'https://')).searchParams.get(
      'capability',
    )!;
    const decoded = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as RoleCapability;
    expect(decoded).toMatchObject({ role: 'instructor', sessionId: 'sess-demo-0001' });
  });

  it('surfaces a relay error instead of hanging', async () => {
    const h = make();
    const promise = h.client.join('sess-demo-0001');
    h.latest().open();
    h.latest().deliver({ kind: 'error', reason: 'session-not-found' });
    await expect(promise).rejects.toThrow('session-not-found');
  });

  it('rejects rather than hanging when the relay never answers', async () => {
    const h = make();
    const promise = h.client.create('sess-demo-0001');
    h.latest().open();
    h.runTimers();
    await expect(promise).rejects.toThrow('did not answer in time');
  });

  it('stops delivery and sends close when closed', () => {
    const h = make();
    h.client.create('sess-demo-0001').catch(() => {});
    h.latest().open();
    const socket = h.latest();

    const seen: unknown[] = [];
    h.client.subscribe(event => seen.push(event));
    h.client.close();

    expect(socket.messages().at(-1)).toEqual({ kind: 'close', sessionId: 'sess-demo-0001' });
    socket.deliver({ kind: 'event', event: { sequence: 99 } });
    expect(seen).toHaveLength(0);
    expect(() => h.client.send({ sequence: 1 })).toThrow('closed');
  });

  it('does not reconnect after an intentional close', () => {
    const h = make();
    h.client.create('sess-demo-0001').catch(() => {});
    h.latest().open();
    const before = 1;
    h.client.close();
    h.runTimers();
    expect(FakeSocket.instances).toHaveLength(before);
  });

  it('gives up reconnecting once the backoff list is exhausted', () => {
    const h = make();
    h.client.create('sess-demo-0001').catch(() => {});
    h.latest().open();

    for (let i = 0; i < 10; i += 1) {
      h.latest().drop();
      h.runTimers();
    }
    // Three backoff entries means at most three reconnects after the original.
    expect(FakeSocket.instances.length).toBeLessThanOrEqual(4);
  });

  it('ignores malformed frames rather than throwing into the socket callback', () => {
    const h = make();
    h.client.create('sess-demo-0001').catch(() => {});
    h.latest().open();
    const seen: unknown[] = [];
    h.client.subscribe(e => seen.push(e));
    expect(() => h.latest().onmessage?.({ data: 'not json' } as MessageEvent)).not.toThrow();
    expect(seen).toHaveLength(0);
  });

  it('does not validate events itself', () => {
    // Part 1's schema is the client-side authority and the relay is the
    // server-side one. A third opinion here could differ from both.
    const h = make();
    h.client.create('sess-demo-0001').catch(() => {});
    h.latest().open();
    const seen: unknown[] = [];
    h.client.subscribe(e => seen.push(e));
    h.latest().deliver({ kind: 'event', event: { nonsense: true } });
    expect(seen).toEqual([{ nonsense: true }]);
  });

  it('warns nobody and crashes nothing when told to close twice', () => {
    const h = make();
    h.client.create('sess-demo-0001').catch(() => {});
    h.latest().open();
    h.client.close();
    expect(() => h.client.close()).not.toThrow();
  });
});

describe('subscribe/send after close', () => {
  it('refuses to subscribe on a closed client', () => {
    const client = new WebSocketSessionClient({
      url: 'wss://relay.example/live',
      socketFactory: url => new FakeSocket(url) as never,
    });
    client.close();
    expect(() => client.subscribe(vi.fn())).toThrow('closed');
  });
});
