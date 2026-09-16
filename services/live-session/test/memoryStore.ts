/**
 * In-memory `SessionStoreApi`, with the same expiry semantics as DynamoDB.
 *
 * Deliberately not a "just store it in a Map" double. The two behaviours that
 * make the real store correct are reproduced here, because they are the two the
 * relay's tests need to exercise:
 *
 *   1. **Expiry is enforced on read.** Records are kept after `expiresAt`
 *      passes -- exactly as DynamoDB keeps them, since TTL deletion is
 *      asynchronous -- and filtered by `isLive` on the way out. A double that
 *      deleted on time would hide the bug this guards against.
 *   2. **`advanceSequence` is conditional.** It re-checks monotonicity, status,
 *      and expiry at write time, so a test can simulate two events racing.
 */
import {
  isLive,
  nowSeconds,
  SESSION_TTL_SECONDS,
  type ConnectionRecord,
  type Role,
  type SessionRecord,
  type SessionStoreApi,
} from '../src/records.js';

export class MemorySessionStore implements SessionStoreApi {
  readonly sessions = new Map<string, SessionRecord>();
  readonly connections = new Map<string, ConnectionRecord>();

  async createSession(
    sessionId: string,
    packId: string,
    packVersion: number,
    now: Date = new Date(),
  ): Promise<SessionRecord> {
    if (this.sessions.has(sessionId)) {
      const error = new Error('exists');
      error.name = 'ConditionalCheckFailedException';
      throw error;
    }
    const record: SessionRecord = {
      sessionId,
      packId,
      packVersion,
      status: 'open',
      lastSequence: 0,
      expiresAt: nowSeconds(now) + SESSION_TTL_SECONDS,
    };
    this.sessions.set(sessionId, record);
    return record;
  }

  async pinSessionPack(sessionId: string, packId: string, packVersion: number): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (!record) throw new Error('missing session');
    this.sessions.set(sessionId, { ...record, packId, packVersion });
  }

  async getSession(sessionId: string, now: Date = new Date()): Promise<SessionRecord | undefined> {
    const record = this.sessions.get(sessionId);
    return isLive(record, nowSeconds(now)) ? record : undefined;
  }

  async advanceSequence(
    sessionId: string,
    sequence: number,
    latestState: Record<string, unknown> | undefined,
    now: Date = new Date(),
  ): Promise<boolean> {
    const record = this.sessions.get(sessionId);
    if (!record) return false;
    if (!isLive(record, nowSeconds(now))) return false;
    if (record.status !== 'open') return false;
    if (record.lastSequence >= sequence) return false;
    record.lastSequence = sequence;
    if (latestState !== undefined) record.latestState = latestState;
    return true;
  }

  async closeSession(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (record) record.status = 'closed';
  }

  async putConnection(
    connectionId: string,
    sessionId: string,
    role: Role,
    now: Date = new Date(),
  ): Promise<void> {
    this.connections.set(connectionId, {
      connectionId,
      sessionId,
      role,
      expiresAt: nowSeconds(now) + SESSION_TTL_SECONDS,
    });
  }

  async getConnection(
    connectionId: string,
    now: Date = new Date(),
  ): Promise<ConnectionRecord | undefined> {
    const record = this.connections.get(connectionId);
    return isLive(record, nowSeconds(now)) ? record : undefined;
  }

  async deleteConnection(connectionId: string): Promise<void> {
    this.connections.delete(connectionId);
  }

  async connectionsForSession(
    sessionId: string,
    now: Date = new Date(),
  ): Promise<ConnectionRecord[]> {
    const at = nowSeconds(now);
    return [...this.connections.values()].filter(c => c.sessionId === sessionId && isLive(c, at));
  }
}
