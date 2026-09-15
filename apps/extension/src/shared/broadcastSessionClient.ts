import { LiveEventSchema, RoleCapabilitySchema, type LiveEvent, type RoleCapability, type SessionClient } from './contracts';

/**
 * Local demo transport behind the frozen SessionClient interface. Uses the
 * browser's BroadcastChannel, so an instructor tab and student tabs in the
 * SAME browser profile and origin follow each other with no network. It does
 * not reach incognito windows, other profiles, other devices, or the
 * extension side panel from a plain tab (different origin). Part 4's AWS
 * WebSocket relay replaces this class; nothing else changes.
 *
 * Only validated LiveEvents cross the channel (charter A2): send() parses
 * with LiveEventSchema before posting, and receivers parse again.
 */
export class BroadcastSessionClient implements SessionClient {
  private listeners = new Set<(e: LiveEvent) => void>();
  private channel: BroadcastChannel | null = null;
  private closed = false;

  async create(sessionId: string): Promise<RoleCapability> {
    this.open(sessionId);
    return this.capability(sessionId, 'instructor');
  }

  async join(sessionId: string): Promise<RoleCapability> {
    this.open(sessionId);
    return this.capability(sessionId, 'student');
  }

  send(event: LiveEvent): void {
    if (this.closed) throw new Error('SessionClient is closed');
    const parsed = LiveEventSchema.parse(event);
    this.channel?.postMessage({ kind: 'event', event: parsed });
    this.listeners.forEach(l => l(parsed));
  }

  subscribe(listener: (e: LiveEvent) => void): () => void {
    if (this.closed) throw new Error('SessionClient is closed');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.channel?.close();
    this.channel = null;
    this.listeners.clear();
  }

  private open(sessionId: string): void {
    if (this.closed) throw new Error('SessionClient is closed');
    this.channel?.close();
    const channel = new BroadcastChannel(`accesslens-session-${sessionId}`);
    channel.onmessage = (message: MessageEvent) => {
      const data = message.data as { kind?: string; event?: unknown };
      if (data?.kind !== 'event') return;
      const result = LiveEventSchema.safeParse(data.event);
      if (result.success) this.listeners.forEach(l => l(result.data));
    };
    this.channel = channel;
  }

  private capability(sessionId: string, role: 'instructor' | 'student'): RoleCapability {
    const issuedAt = new Date();
    return RoleCapabilitySchema.parse({
      schemaVersion: '1.0', sessionId, role,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 60 * 60 * 1000).toISOString(),
      token: `local-${role}-${sessionId}`,
    });
  }
}

/** BroadcastChannel where available, otherwise callers should fall back to InMemorySessionClient. */
export const hasBroadcastChannel = (): boolean => typeof BroadcastChannel !== 'undefined';
