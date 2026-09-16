/**
 * The relay's decision logic, with no Lambda or AWS SDK in sight.
 *
 * `handler.ts` is the thin adapter that turns an API Gateway event into these
 * calls and posts the results back. Everything that decides *whether* an event
 * is delivered lives here, so it can be tested against the reviewed fixtures
 * without deploying anything -- which is what Part 4's "independent test path"
 * in `PARALLEL_WORKSTREAMS.md` asks for: "use fixture WebSocket clients and
 * contract payloads; no browser extension is needed until integration."
 *
 * The operations are the ones the contract freeze named: create, join, relay,
 * latest-state, disconnect, and close.
 */
import { checkEvent, type PackIndex } from './rules.js';
import {
  issueCapability,
  verifyCapability,
  type Role,
  type RoleCapability,
} from './capability.js';
import type { SessionStoreApi } from './records.js';
import { log, logEvent } from './log.js';

/** Events that establish the current student-visible lifecycle or reviewed view.
 * The relay holds only one latest event, never capture media or session history. */
const VIEW_BEARING = new Set([
  'session.started',
  'asset.changed',
  'region.changed',
  'capture.paused',
  'capture.resumed',
  'capture.stopped',
  'source.unmatched',
]);

export interface RelayConfig {
  store: SessionStoreApi;
  pack: PackIndex;
  secret: string;
  /** Deliver one event to one connection. Returns false if the peer is gone. */
  post: (connectionId: string, payload: unknown) => Promise<boolean>;
}

export type RelayOutcome =
  | { status: 'ok'; capability?: RoleCapability; delivered?: number }
  | { status: 'rejected'; rules: string[] }
  | { status: 'error'; reason: string };

export class Relay {
  constructor(private readonly config: RelayConfig) {}

  /**
   * Create a session and take the instructor capability for it.
   *
   * Creating is what makes you the instructor -- there is no separate grant
   * step, because there is no identity system to grant against. Re-creating an
   * existing session is not an error (an instructor whose laptop slept should
   * get their capability back), but it must not reset the sequence counter,
   * which is why `createSession` is conditional and the failure is swallowed
   * only for the already-exists case.
   */
  async create(
    connectionId: string,
    sessionId: string,
    now: Date = new Date(),
  ): Promise<RelayOutcome> {
    try {
      await this.config.store.createSession(
        sessionId,
        this.config.pack.packId,
        this.config.pack.version,
        now,
      );
    } catch (error) {
      if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') {
        log.error('session-create-failed', { sessionId, error: String(error) });
        return { status: 'error', reason: 'session-create-failed' };
      }
      const existing = await this.config.store.getSession(sessionId, now);
      if (!existing) return { status: 'error', reason: 'session-expired' };
      if (existing.status === 'closed') return { status: 'error', reason: 'session-not-open' };
    }

    await this.config.store.putConnection(connectionId, sessionId, 'instructor', now);
    const capability = issueCapability(sessionId, 'instructor', this.config.secret, now);
    log.info('session-created', { sessionId, role: 'instructor' });
    return { status: 'ok', capability };
  }

  /**
   * Join an open session as a student, and be caught up.
   *
   * The catch-up is the latest view, not a replay. `reconnect-latest-state`'s
   * expectation is explicit about this, and it is also the privacy-preserving
   * choice: the relay holds one current view per session rather than the
   * session's history.
   */
  async join(
    connectionId: string,
    sessionId: string,
    role: Role,
    now: Date = new Date(),
  ): Promise<RelayOutcome> {
    const session = await this.config.store.getSession(sessionId, now);
    if (!session) return { status: 'error', reason: 'session-not-found' };
    if (session.status !== 'open') return { status: 'error', reason: 'session-not-open' };

    // A join cannot mint an instructor capability -- that is what `create` is
    // for. Without this, "join as instructor" would be an open door.
    if (role !== 'student') return { status: 'error', reason: 'role-not-grantable-by-join' };

    await this.config.store.putConnection(connectionId, sessionId, 'student', now);
    const capability = issueCapability(sessionId, 'student', this.config.secret, now);
    log.info('session-joined', { sessionId, role: 'student' });

    if (session.latestState) {
      await this.config.post(connectionId, { kind: 'event', event: session.latestState });
    }
    return { status: 'ok', capability };
  }

  /**
   * Re-bind a reconnecting client to its role using a signed capability, and
   * catch it up. This is the path where the capability earns its keep: the
   * connection is new, so the relay has no memory of this client at all, and
   * the token is the only evidence of what role it held.
   */
  async resume(
    connectionId: string,
    sessionId: string,
    capability: unknown,
    now: Date = new Date(),
  ): Promise<RelayOutcome> {
    const verdict = verifyCapability(capability, sessionId, this.config.secret, now);
    if (!verdict.ok) {
      log.warn('capability-rejected', { sessionId, reason: verdict.reason });
      return { status: 'error', reason: verdict.reason };
    }
    const session = await this.config.store.getSession(sessionId, now);
    if (!session) return { status: 'error', reason: 'session-not-found' };
    if (session.status !== 'open') return { status: 'error', reason: 'session-not-open' };

    await this.config.store.putConnection(connectionId, sessionId, verdict.role, now);
    if (verdict.role === 'student' && session.latestState) {
      await this.config.post(connectionId, { kind: 'event', event: session.latestState });
    }
    log.info('session-resumed', { sessionId, role: verdict.role });
    return { status: 'ok' };
  }

  /**
   * Validate an event and relay it to the session's students.
   *
   * Three gates, in this order, and each one exists because the one before it
   * cannot do its job:
   *
   *   1. `checkEvent` -- shape, pack consistency, role, and monotonicity
   *      against the sequence the relay last *saw*.
   *   2. `advanceSequence` -- the same monotonicity, decided by the database
   *      under a condition expression. Two events arriving in the same
   *      millisecond both pass gate 1 against the same `lastSequence`; only one
   *      can win gate 2.
   *   3. Delivery -- students only. The publisher is not echoed its own event.
   */
  async publish(
    connectionId: string,
    event: Record<string, unknown>,
    now: Date = new Date(),
  ): Promise<RelayOutcome> {
    const connection = await this.config.store.getConnection(connectionId, now);
    if (!connection) return { status: 'error', reason: 'connection-not-bound' };

    const sessionId = connection.sessionId;
    if (event.sessionId !== sessionId) {
      // Publishing into someone else's session, using this session's role.
      return { status: 'rejected', rules: ['session-id-mismatch'] };
    }

    const session = await this.config.store.getSession(sessionId, now);
    const rules = checkEvent(event, this.config.pack, {
      lastSequence: session?.lastSequence ?? 0,
      role: connection.role,
      sessionOpen: session !== undefined && session.status === 'open',
    });
    if (rules.length > 0) {
      logEvent('warn', 'event-rejected', event, { rules: rules.join(','), count: rules.length });
      return { status: 'rejected', rules };
    }

    const latestState = VIEW_BEARING.has(event.type as string) ? event : undefined;
    const claimed = await this.config.store.advanceSequence(
      sessionId,
      event.sequence as number,
      latestState,
      now,
    );
    if (!claimed) {
      // Lost the race, or the session closed between the read and the write.
      logEvent('warn', 'event-rejected', event, { rules: 'sequence-not-monotonic', count: 1 });
      return { status: 'rejected', rules: ['sequence-not-monotonic'] };
    }

    const connections = await this.config.store.connectionsForSession(sessionId, now);
    let delivered = 0;
    await Promise.all(
      connections
        .filter(c => c.role === 'student' && c.connectionId !== connectionId)
        .map(async c => {
          const ok = await this.config.post(c.connectionId, { kind: 'event', event });
          if (ok) delivered += 1;
          else await this.config.store.deleteConnection(c.connectionId);
        }),
    );

    logEvent('info', 'event-relayed', event, { delivered });

    // `session.ended` is terminal. `capture.stopped` is deliberately not: it
    // freezes student views while leaving this temporary session available for
    // a fresh, explicit browser capture on the same join code.
    if (event.type === 'session.ended') await this.config.store.closeSession(sessionId);

    return { status: 'ok', delivered };
  }

  /**
   * Close a session. Instructor only, and immediate: the status flips before
   * this returns, so the next event fails gate 1 and gate 2 both.
   */
  async close(
    connectionId: string,
    sessionId: string,
    now: Date = new Date(),
  ): Promise<RelayOutcome> {
    const connection = await this.config.store.getConnection(connectionId, now);
    if (!connection || connection.sessionId !== sessionId) {
      return { status: 'error', reason: 'connection-not-bound' };
    }
    if (connection.role !== 'instructor') {
      return { status: 'error', reason: 'role-not-permitted-to-close' };
    }
    await this.config.store.closeSession(sessionId);
    log.info('session-closed', { sessionId });
    return { status: 'ok' };
  }

  /** Forget a connection. Never ends the session -- an instructor whose network
   *  blipped has not finished teaching. */
  async disconnect(connectionId: string): Promise<void> {
    await this.config.store.deleteConnection(connectionId);
  }
}
