import { describe, it, expect, vi } from 'vitest';
import { wrapLiveRelayClient } from './liveRelayClient';
import { validEvent } from '../shared/fixtures';

interface FakeUnderlying {
  create(sessionId: string): Promise<unknown>;
  join(sessionId: string): Promise<unknown>;
  send(event: unknown): void;
  subscribe(listener: (event: unknown) => void): () => void;
  close(): void;
  emit(payload: unknown): void;
}

function fakeUnderlying(): FakeUnderlying {
  let listener: ((event: unknown) => void) | undefined;
  return {
    create: vi.fn(async (sessionId: string) => ({
      schemaVersion: '1.0', sessionId, role: 'instructor', issuedAt: '2026-09-16T00:00:00Z', expiresAt: '2026-09-16T01:00:00Z', token: 'tok',
    })),
    join: vi.fn(async (sessionId: string) => ({
      schemaVersion: '1.0', sessionId, role: 'student', issuedAt: '2026-09-16T00:00:00Z', expiresAt: '2026-09-16T01:00:00Z', token: 'tok',
    })),
    send: vi.fn(),
    subscribe: vi.fn((l: (event: unknown) => void) => { listener = l; return () => { listener = undefined; }; }),
    close: vi.fn(),
    emit(payload: unknown) { listener?.(payload); },
  };
}

describe('wrapLiveRelayClient', () => {
  it('forwards a schema-valid event to subscribers, strongly typed', () => {
    const underlying = fakeUnderlying();
    const client = wrapLiveRelayClient(underlying);
    const received: unknown[] = [];
    client.subscribe(e => received.push(e));

    underlying.emit(validEvent);

    expect(received).toEqual([validEvent]);
  });

  it('drops an event that fails LiveEventSchema instead of forwarding or throwing', () => {
    const underlying = fakeUnderlying();
    const client = wrapLiveRelayClient(underlying);
    const received: unknown[] = [];
    client.subscribe(e => received.push(e));

    expect(() => underlying.emit({ not: 'a live event' })).not.toThrow();
    expect(received).toEqual([]);
  });

  it('delegates send with the given event', () => {
    const underlying = fakeUnderlying();
    const client = wrapLiveRelayClient(underlying);

    client.send(validEvent);

    expect(underlying.send).toHaveBeenCalledWith(validEvent);
  });

  it('delegates create and returns the validated capability', async () => {
    const underlying = fakeUnderlying();
    const client = wrapLiveRelayClient(underlying);

    const capability = await client.create('demo-session');

    expect(underlying.create).toHaveBeenCalledWith('demo-session');
    expect(capability).toEqual({ schemaVersion: '1.0', sessionId: 'demo-session', role: 'instructor', issuedAt: '2026-09-16T00:00:00Z', expiresAt: '2026-09-16T01:00:00Z', token: 'tok' });
  });

  it('delegates join and returns the validated capability', async () => {
    const underlying = fakeUnderlying();
    const client = wrapLiveRelayClient(underlying);

    const capability = await client.join('demo-session');

    expect(underlying.join).toHaveBeenCalledWith('demo-session');
    expect(capability.role).toBe('student');
  });

  it('rejects create when the relay returns a malformed capability', async () => {
    const underlying = fakeUnderlying();
    underlying.create = vi.fn(async () => ({ nonsense: true }));
    const client = wrapLiveRelayClient(underlying);

    await expect(client.create('demo-session')).rejects.toThrow();
  });

  it('delegates close to the underlying client', () => {
    const underlying = fakeUnderlying();
    const client = wrapLiveRelayClient(underlying);

    client.close();

    expect(underlying.close).toHaveBeenCalled();
  });

  it('passes through real connection status when the underlying client supports it', () => {
    const underlying = fakeUnderlying() as FakeUnderlying & { onConnectionChange(listener: (connected: boolean) => void): () => void };
    let notify: ((connected: boolean) => void) | undefined;
    underlying.onConnectionChange = (listener: (connected: boolean) => void) => {
      notify = listener;
      return () => { notify = undefined; };
    };
    const client = wrapLiveRelayClient(underlying);

    expect(client.onConnectionChange).toBeDefined();
    const statuses: boolean[] = [];
    client.onConnectionChange!(connected => statuses.push(connected));
    notify?.(true);
    notify?.(false);

    expect(statuses).toEqual([true, false]);
  });

  it('has no onConnectionChange when the underlying client does not support it', () => {
    const underlying = fakeUnderlying();
    const client = wrapLiveRelayClient(underlying);

    expect(client.onConnectionChange).toBeUndefined();
  });
});
