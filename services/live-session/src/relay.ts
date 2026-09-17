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
 *
 * Video. The relay owns the *lifecycle* of a session's video stage on Amazon
 * IVS Real-Time and nothing else about video: it creates the stage with the
 * session, mints a publish token for the instructor and subscribe-only tokens
 * for students next to their capabilities, relays the two `stream.*` state
 * events, and deletes the stage when the session closes. Not one frame passes
 * through here; the events say that video exists and what kind of surface it
 * shows, and the tokens let the browsers reach IVS directly.
 */
import { checkEvent, type PackIndex } from './rules.js';
import {
  CAPABILITY_TTL_SECONDS,
  issueCapability,
  verifyCapability,
  type Role,
  type RoleCapability,
} from './capability.js';
import type { LatestUpdate, SessionRecord, SessionStoreApi } from './records.js';
import type { StagePort, StreamRole } from './stage.js';
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
  'screen.analyzed',
]);

/** Events after which no video is streaming. `stream.started` is the one that says it is. */
const STREAM_CLEARING = new Set(['stream.stopped', 'capture.stopped', 'session.ended']);

/** A capability plus the video token minted beside it, when the session has video. */
export type IssuedCapability = RoleCapability & { streamToken?: string };

export interface RelayConfig {
  store: SessionStoreApi;
  /** The video stage per session. Its failures never stop a session from opening. */
  stage: StagePort;
  /** The reviewed pack the relay ships with; sessions teaching it need no lookup. */
  pack: PackIndex;
  /**
   * Any other pack, by id and version, from the published distribution. A
   * session is pinned to the pack its first accepted event names, so every
   * later event is checked against that pack and a client on a different
   * version is refused (T-19). Without a resolver only the shipped pack works.
   */
  resolvePack?: (packId: string, version: number) => Promise<PackIndex | undefined>;
  secret: string;
  /** Deliver one event to one connection. Returns false if the peer is gone. */
  post: (connectionId: string, payload: unknown) => Promise<boolean>;
}

export type RelayOutcome =
  | { status: 'ok'; capability?: IssuedCapability; delivered?: number }
  | { status: 'rejected'; rules: string[] }
  | { status: 'error'; reason: string };

export class Relay {
  private readonly packs = new Map<string, PackIndex>();

  constructor(private readonly config: RelayConfig) {}

  private async packFor(packId: unknown, version: unknown): Promise<PackIndex | undefined> {
    // A malformed reference is checked against the shipped pack so the
    // ordinary rules (missing fields, mismatched ids) report it.
    if (typeof packId !== 'string' || typeof version !== 'number') return this.config.pack;
    if (packId === this.config.pack.packId && version === this.config.pack.version) return this.config.pack;
    const key = `${packId}@${version}`;
    const cached = this.packs.get(key);
    if (cached) return cached;
    const resolved = await this.config.resolvePack?.(packId, version);
    if (resolved) this.packs.set(key, resolved);
    return resolved;
  }

  /**
   * A capability, with a video token beside it when the session has a stage.
   * Minting can fail (a throttled or unavailable video service); the session
   * is still usable, so the capability goes out without the token and the
   * console tells the instructor video is unavailable.
   */
  private async issue(
    session: SessionRecord | undefined,
    sessionId: string,
    role: Role,
    streamRole: StreamRole,
    now: Date,
  ): Promise<IssuedCapability> {
    const capability = issueCapability(sessionId, role, this.config.secret, now);
    if (!session?.stageArn) return capability;
    try {
      const streamToken = await this.config.stage.createToken(session.stageArn, streamRole, CAPABILITY_TTL_SECONDS);
      return { ...capability, streamToken };
    } catch (error) {
      log.warn('stream-token-failed', { sessionId, role, error: String(error) });
      return capability;
    }
  }

  /** Delete the session's stage, if it has one. Idempotent; a failure is logged, not raised. */
  private async releaseStage(session: SessionRecord | undefined): Promise<void> {
    if (!session?.stageArn) return;
    try {
      await this.config.stage.deleteStage(session.stageArn);
      log.info('stage-deleted', { sessionId: session.sessionId });
    } catch (error) {
      log.warn('stage-delete-failed', { sessionId: session.sessionId, error: String(error) });
    }
  }

  /** Catch a student up: the latest view, then whether video is streaming, in sequence order. */
  private async catchUp(connectionId: string, session: SessionRecord): Promise<void> {
    const latest = [session.latestState, session.latestStream]
      .filter((event): event is Record<string, unknown> => event !== undefined)
      .sort((a, b) => Number(a.sequence) - Number(b.sequence));
    for (const event of latest) await this.config.post(connectionId, { kind: 'event', event });
  }

  /**
   * Create a session and take the instructor capability for it.
   *
   * Creating is what makes you the instructor -- there is no separate grant
   * step, because there is no identity system to grant against. Re-creating an
   * existing session is not an error (an instructor whose laptop slept should
   * get their capability back), but it must not reset the sequence counter,
   * which is why `createSession` is conditional and the failure is swallowed
   * only for the already-exists case.
   *
   * The video stage is created with the session. If the stage cannot be
   * created the session still opens, without video (decision 9): slide
   * following is the product and video is beside it.
   */
  async create(
    connectionId: string,
    sessionId: string,
    now: Date = new Date(),
  ): Promise<RelayOutcome> {
    let session = await this.config.store.getSession(sessionId, now);
    if (!session) {
      let stageArn: string | undefined;
      try {
        stageArn = await this.config.stage.createStage(sessionId);
      } catch (error) {
        log.warn('stage-create-failed', { sessionId, error: String(error) });
      }
      try {
        // The pack is pinned by the first accepted event, not chosen here:
        // `create` carries no pack on the frozen contract.
        session = await this.config.store.createSession(sessionId, '', 0, stageArn, now);
      } catch (error) {
        // Whatever happened, the session record does not carry this stage.
        if (stageArn) await this.releaseStage({ sessionId, stageArn } as SessionRecord);
        if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') {
          log.error('session-create-failed', { sessionId, error: String(error) });
          return { status: 'error', reason: 'session-create-failed' };
        }
        // Lost a race with another create, or the row is expired but not yet
        // swept: `getSession` tells the two apart.
        session = await this.config.store.getSession(sessionId, now);
        if (!session) return { status: 'error', reason: 'session-expired' };
      }
    }
    if (session.status === 'closed') return { status: 'error', reason: 'session-not-open' };

    await this.config.store.putConnection(connectionId, sessionId, 'instructor', now);
    const capability = await this.issue(session, sessionId, 'instructor', 'publish', now);
    log.info('session-created', { sessionId, role: 'instructor', video: capability.streamToken !== undefined });
    return { status: 'ok', capability };
  }

  /**
   * Join an open session as a student, and be caught up.
   *
   * The catch-up is the latest view, not a replay. `reconnect-latest-state`'s
   * expectation is explicit about this, and it is also the privacy-preserving
   * choice: the relay holds one current view per session rather than the
   * session's history. If the instructor is streaming video, the
   * `stream.started` in force follows, so a late student subscribes too.
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
    const capability = await this.issue(session, sessionId, 'student', 'subscribe', now);
    log.info('session-joined', { sessionId, role: 'student' });

    await this.catchUp(connectionId, session);
    return { status: 'ok', capability };
  }

  /**
   * Re-bind a reconnecting client to its role using a signed capability, and
   * catch it up. This is the path where the capability earns its keep: the
   * connection is new, so the relay has no memory of this client at all, and
   * the token is the only evidence of what role it held.
   *
   * No video token is minted here. A resuming client still holds the one it
   * was issued at create or join, which lives as long as the capability does;
   * and this runs on `$connect`, where nothing can be posted back anyway.
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
    if (verdict.role === 'student') await this.catchUp(connectionId, session);
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
    const pinned = session && session.packId ? { packId: session.packId, version: session.packVersion } : undefined;
    const pack = await this.packFor(pinned?.packId ?? event.packId, pinned?.version ?? event.packVersion);
    if (!pack) {
      logEvent('warn', 'event-rejected', event, { rules: 'pack-not-found', count: 1 });
      return { status: 'rejected', rules: ['pack-not-found'] };
    }
    const rules = checkEvent(event, pack, {
      lastSequence: session?.lastSequence ?? 0,
      role: connection.role,
      sessionOpen: session !== undefined && session.status === 'open',
    });
    if (rules.length > 0) {
      logEvent('warn', 'event-rejected', event, { rules: rules.join(','), count: rules.length });
      return { status: 'rejected', rules };
    }

    const type = event.type as string;
    const latest: LatestUpdate = {};
    if (VIEW_BEARING.has(type)) latest.view = event;
    if (type === 'stream.started') latest.stream = event;
    else if (STREAM_CLEARING.has(type)) latest.stream = null;
    const claimed = await this.config.store.advanceSequence(sessionId, event.sequence as number, latest, now);
    if (!claimed) {
      // Lost the race, or the session closed between the read and the write.
      logEvent('warn', 'event-rejected', event, { rules: 'sequence-not-monotonic', count: 1 });
      return { status: 'rejected', rules: ['sequence-not-monotonic'] };
    }

    if (session && !pinned) await this.config.store.pinSessionPack(sessionId, pack.packId, pack.version);

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
    if (type === 'session.ended') {
      await this.config.store.closeSession(sessionId);
      await this.releaseStage(session);
    }

    return { status: 'ok', delivered };
  }

  /**
   * Close a session. Instructor only, and immediate: the status flips before
   * this returns, so the next event fails gate 1 and gate 2 both. The video
   * stage goes with it, disconnecting anyone still watching.
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
    const session = await this.config.store.getSession(sessionId, now);
    await this.config.store.closeSession(sessionId);
    await this.releaseStage(session);
    log.info('session-closed', { sessionId });
    return { status: 'ok' };
  }

  /** Forget a connection. Never ends the session -- an instructor whose network
   *  blipped has not finished teaching. */
  async disconnect(connectionId: string): Promise<void> {
    await this.config.store.deleteConnection(connectionId);
  }
}
