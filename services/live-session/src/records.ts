/**
 * Session and connection records, and the expiry rule -- with no AWS import.
 *
 * Split out of `store.ts` deliberately. The repository's root `vitest` run
 * globs `**\/*.test.ts`, so it collects this package's tests too; if the types
 * and helpers they need lived beside the DynamoDB client, running Part 1's
 * `npm run check` would require `npm install` inside `services/live-session`
 * first, and would fail in CI the moment T-08's `npm ci` fix lands. Keeping the
 * domain layer free of `@aws-sdk` means the shared check keeps working whether
 * or not this package's dependencies are installed.
 *
 * It is also the better seam on its own merits: `SessionStoreApi` is the shape
 * the relay depends on, and DynamoDB is one implementation of it.
 */

export type Role = 'instructor' | 'student';
export type SessionStatus = 'open' | 'closed';

export interface SessionRecord {
  sessionId: string;
  packId: string;
  packVersion: number;
  status: SessionStatus;
  lastSequence: number;
  /** The most recent view-bearing event, for reconnect catch-up. */
  latestState?: Record<string, unknown>;
  /**
   * The `stream.started` event in force, if the instructor is streaming a tab
   * or window. Cleared by `stream.stopped`, `capture.stopped` and
   * `session.ended`, so a student who joins mid-stream is told to subscribe
   * and one who joins after it ended is not.
   */
  latestStream?: Record<string, unknown>;
  /**
   * The IVS Real-Time stage that carries this session's video. Absent when the
   * stage could not be created; the session then works without video. Only
   * the ARN is stored: tokens are minted per connection and never persisted.
   */
  stageArn?: string;
  /** Unix seconds. Also the DynamoDB TTL attribute. */
  expiresAt: number;
}

/**
 * What one accepted event does to the session's catch-up state. `view` replaces
 * the latest view-bearing event; `stream` replaces the stream state, `null`
 * clearing it. Omitted fields are left as they were.
 */
export interface LatestUpdate {
  view?: Record<string, unknown>;
  stream?: Record<string, unknown> | null;
}

export interface ConnectionRecord {
  connectionId: string;
  sessionId: string;
  role: Role;
  expiresAt: number;
}

/** Sessions live for one class period; the TTL is the backstop for a session
 *  nobody closed, not the normal way one ends. */
export const SESSION_TTL_SECONDS = 4 * 60 * 60;

export const nowSeconds = (now: Date = new Date()) => Math.floor(now.getTime() / 1000);

/**
 * Is this record still live at `at`?
 *
 * Never trust that DynamoDB removed an expired row: TTL deletion is
 * asynchronous and can lag by up to 48 hours. `expiresAt` is compared on every
 * read path instead.
 */
export function isLive(record: { expiresAt: number } | undefined, at: number): boolean {
  return record !== undefined && record.expiresAt > at;
}

/**
 * The storage surface the relay actually uses.
 *
 * `Relay` depends on this rather than on `SessionStore` so the decision logic
 * can be tested against an in-memory double. Every "Done when" criterion in
 * `PARALLEL_WORKSTREAMS.md` Part 4 is then provable without a deployed stack,
 * and the deployed stack becomes a check that the wiring is right rather than
 * the only place behaviour is observable.
 */
export interface SessionStoreApi {
  createSession(
    sessionId: string,
    packId: string,
    packVersion: number,
    stageArn: string | undefined,
    now?: Date,
  ): Promise<SessionRecord>;
  getSession(sessionId: string, now?: Date): Promise<SessionRecord | undefined>;
  /** Record which pack a session teaches, decided by its first accepted event. */
  pinSessionPack(sessionId: string, packId: string, packVersion: number): Promise<void>;
  advanceSequence(
    sessionId: string,
    sequence: number,
    latest: LatestUpdate,
    now?: Date,
  ): Promise<boolean>;
  closeSession(sessionId: string): Promise<void>;
  putConnection(connectionId: string, sessionId: string, role: Role, now?: Date): Promise<void>;
  getConnection(connectionId: string, now?: Date): Promise<ConnectionRecord | undefined>;
  deleteConnection(connectionId: string): Promise<void>;
  connectionsForSession(sessionId: string, now?: Date): Promise<ConnectionRecord[]>;
}
