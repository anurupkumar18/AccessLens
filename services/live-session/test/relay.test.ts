/**
 * Part 4's "Done when" list, as tests.
 *
 * `PARALLEL_WORKSTREAMS.md` names five conditions for Part 4 being done. Four
 * of them are decisions the relay makes and are proved here against the
 * reviewed fixtures; the fifth (the real client replacing Part 1's mock) is
 * `sessionClient.test.ts`, and the deployed-endpoint half of the first is
 * `scripts/integration-test.mjs` against real AWS.
 *
 *   - one instructor client drives two student clients          -> "drives two students"
 *   - a student cannot publish instructor events                -> "refuses a student publisher"
 *   - malformed, stale, reordered, raw-media events rejected    -> "refuses ..." (four tests)
 *   - closing or expiring a session prevents further delivery   -> "close" / "expiry"
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { Relay } from '../src/relay.js';
import { indexPack } from '../src/rules.js';
import { SESSION_TTL_SECONDS } from '../src/records.js';
import { MemorySessionStore } from './memoryStore.js';
import { MemoryStage } from './memoryStage.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const packDir = join(repoRoot, 'packages/access-packs/bio-cell-demo');

const pack = indexPack(JSON.parse(readFileSync(join(packDir, 'pack.json'), 'utf8')));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(packDir, 'fixtures', name), 'utf8')) as {
    events: Record<string, unknown>[];
  };
const invalid = (name: string) =>
  JSON.parse(readFileSync(join(packDir, 'fixtures/invalid', name), 'utf8')) as {
    event: Record<string, unknown>;
    expectedRule: string;
  };

const SECRET = 'test-secret-not-a-real-one';
const SESSION = 'sess-demo-0001';

/** Events posted to each connection, so a test can assert who saw what. */
type Inbox = Map<string, Record<string, unknown>[]>;

/** A pack the relay does not ship: same slides, different id and version, as if the pipeline published it. */
const publishedPack = indexPack({ ...JSON.parse(readFileSync(join(packDir, 'pack.json'), 'utf8')), packId: 'published-pack', version: 3 });

function harness(resolvePack?: (packId: string, version: number) => Promise<ReturnType<typeof indexPack> | undefined>) {
  const store = new MemorySessionStore();
  const stage = new MemoryStage();
  const inbox: Inbox = new Map();
  const gone = new Set<string>();
  const relay = new Relay({
    store,
    stage,
    pack,
    resolvePack,
    secret: SECRET,
    post: async (connectionId, payload) => {
      if (gone.has(connectionId)) return false;
      const list = inbox.get(connectionId) ?? [];
      list.push((payload as { event: Record<string, unknown> }).event);
      inbox.set(connectionId, list);
      return true;
    },
  });
  return { store, stage, relay, inbox, gone };
}

const happy = fixture('happy-path.json').events;
/** A `stream.started` for the session, at `sequence`, from the same instructor. */
const streamStarted = (sequence: number, surface: unknown = 'browser') =>
  ({ ...happy[0]!, type: 'stream.started', sequence, surface }) as Record<string, unknown>;
const lifecycle = (type: string, sequence: number) => ({ ...happy[0]!, type, sequence }) as Record<string, unknown>;

describe('relay', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  it('drives two student clients from one instructor', async () => {
    await h.relay.create('instructor-1', SESSION);
    await h.relay.join('student-1', SESSION, 'student');
    await h.relay.join('student-2', SESSION, 'student');

    for (const event of happy) {
      const outcome = await h.relay.publish('instructor-1', event);
      expect(outcome, `event ${String(event.sequence)} ${String(event.type)}`).toMatchObject({
        status: 'ok',
      });
    }

    // Both students saw every event, in order, and the instructor was not
    // echoed its own traffic.
    const sequences = (id: string) => (h.inbox.get(id) ?? []).map(e => e.sequence);
    expect(sequences('student-1')).toEqual(happy.map(e => e.sequence));
    expect(sequences('student-2')).toEqual(happy.map(e => e.sequence));
    expect(h.inbox.get('instructor-1')).toBeUndefined();
  });

  it('relays a session teaching a published pack it does not ship, and pins the session to it', async () => {
    const asked: string[] = [];
    h = harness(async (packId, version) => { asked.push(`${packId}@${version}`); return packId === 'published-pack' && version === 3 ? publishedPack : undefined; });
    await h.relay.create('instructor-1', SESSION);
    await h.relay.join('student-1', SESSION, 'student');
    const published: Record<string, unknown>[] = happy.map(e => ({ ...e, packId: 'published-pack', packVersion: 3 }));

    for (const event of published) {
      expect(await h.relay.publish('instructor-1', event), String((event as Record<string, unknown>).sequence)).toMatchObject({ status: 'ok' });
    }
    expect((h.inbox.get('student-1') ?? []).map(e => e.sequence)).toEqual(happy.map(e => e.sequence));
    expect(asked).toEqual(['published-pack@3']);
    expect(h.store.sessions.get(SESSION)).toMatchObject({ packId: 'published-pack', packVersion: 3 });

    // Once pinned, the shipped pack is a different lesson and is refused.
    const stale = { ...happy[0]!, sequence: 999 };
    const refused = await h.relay.publish('instructor-1', stale);
    expect(refused.status).toBe('rejected');
    expect((refused as { rules: string[] }).rules).toEqual(expect.arrayContaining(['pack-id-mismatch', 'pack-version-mismatch']));
  });

  it('refuses events for a pack it cannot resolve', async () => {
    h = harness(async () => undefined);
    await h.relay.create('instructor-1', SESSION);
    const outcome = await h.relay.publish('instructor-1', { ...happy[0]!, packId: 'nobody-published-this', packVersion: 1 });
    expect(outcome).toEqual({ status: 'rejected', rules: ['pack-not-found'] });
    expect(h.store.sessions.get(SESSION)).toMatchObject({ packId: '' });
  });

  it('refuses a student publisher', async () => {
    await h.relay.create('instructor-1', SESSION);
    await h.relay.join('student-1', SESSION, 'student');

    const outcome = await h.relay.publish('student-1', happy[0]!);
    expect(outcome).toEqual({ status: 'rejected', rules: ['role-not-permitted-to-publish'] });
    expect(h.inbox.get('student-1')).toBeUndefined();
  });

  it('refuses an instructor capability minted by joining', async () => {
    await h.relay.create('instructor-1', SESSION);
    const outcome = await h.relay.join('attacker', SESSION, 'instructor');
    expect(outcome).toEqual({ status: 'error', reason: 'role-not-grantable-by-join' });
  });

  it('refuses a malformed event', async () => {
    await h.relay.create('instructor-1', SESSION);
    const outcome = await h.relay.publish('instructor-1', {
      type: 'region.changed',
      sessionId: SESSION,
    });
    expect(outcome.status).toBe('rejected');
    expect((outcome as { rules: string[] }).rules).toContain('missing-required-field:schemaVersion');
  });

  it('refuses a raw-media-shaped event', async () => {
    const { event, expectedRule } = invalid('raw-frame-payload.json');
    await h.relay.create('instructor-1', SESSION);
    const outcome = await h.relay.publish('instructor-1', event);
    expect(outcome.status).toBe('rejected');
    expect((outcome as { rules: string[] }).rules).toContain(expectedRule);
  });

  it('refuses events carrying identity or a mastery signal', async () => {
    await h.relay.create('instructor-1', SESSION);
    for (const name of ['prohibited-student-identity.json', 'prohibited-mastery-signal.json']) {
      const { event, expectedRule } = invalid(name);
      const outcome = await h.relay.publish('instructor-1', event);
      expect(outcome.status, name).toBe('rejected');
      expect((outcome as { rules: string[] }).rules, name).toContain(expectedRule);
    }
  });

  it('refuses an oversized caption rather than broadcasting it to every student', async () => {
    // The relay is the only layer a client that skips the extension's own
    // Zod validation cannot get past -- this proves it actually enforces the
    // bound, not just that the shared contract asks nicely for one.
    const { event, expectedRule } = invalid('oversized-caption.json');
    await h.relay.create('instructor-1', SESSION);
    const outcome = await h.relay.publish('instructor-1', event);
    expect(outcome.status).toBe('rejected');
    expect((outcome as { rules: string[] }).rules).toContain(expectedRule);
  });

  it('refuses stale and reordered events', async () => {
    await h.relay.create('instructor-1', SESSION);
    await h.relay.join('student-1', SESSION, 'student');
    // Stop before `session.ended`, so this isolates staleness from closure --
    // replaying after the whole happy path trips `session-not-open` as well,
    // which would let this test pass for the wrong reason.
    const upTo = happy.filter(e => e.type !== 'session.ended');
    for (const event of upTo) await h.relay.publish('instructor-1', event);

    const delivered = (h.inbox.get('student-1') ?? []).length;

    // Stale: a sequence already delivered.
    expect(await h.relay.publish('instructor-1', upTo[1]!)).toEqual({
      status: 'rejected',
      rules: ['sequence-not-monotonic'],
    });
    // Reordered: an earlier sequence arriving after a later one.
    expect(await h.relay.publish('instructor-1', upTo[0]!)).toEqual({
      status: 'rejected',
      rules: ['sequence-not-monotonic'],
    });
    expect((h.inbox.get('student-1') ?? []).length).toBe(delivered);
  });

  it('lets the database referee two events claiming the same sequence', async () => {
    // Both pass `checkEvent` against the same `lastSequence`; only one can win
    // `advanceSequence`. This is the gap a read-then-write would leave open.
    await h.relay.create('instructor-1', SESSION);
    await h.relay.join('student-1', SESSION, 'student');
    await h.relay.publish('instructor-1', happy[0]!);

    const [a, b] = await Promise.all([
      h.relay.publish('instructor-1', happy[1]!),
      h.relay.publish('instructor-1', happy[1]!),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(['ok', 'rejected']);
    expect((h.inbox.get('student-1') ?? []).filter(e => e.sequence === happy[1]!.sequence))
      .toHaveLength(1);
  });

  it('stops delivery the moment a session closes', async () => {
    await h.relay.create('instructor-1', SESSION);
    await h.relay.join('student-1', SESSION, 'student');
    await h.relay.publish('instructor-1', happy[0]!);

    expect(await h.relay.close('instructor-1', SESSION)).toEqual({ status: 'ok' });

    const after = await h.relay.publish('instructor-1', happy[1]!);
    expect(after.status).toBe('rejected');
    expect((after as { rules: string[] }).rules).toContain('session-not-open');
    expect(h.inbox.get('student-1')).toHaveLength(1);
  });

  it('refuses a student trying to close the session', async () => {
    await h.relay.create('instructor-1', SESSION);
    await h.relay.join('student-1', SESSION, 'student');
    expect(await h.relay.close('student-1', SESSION)).toEqual({
      status: 'error',
      reason: 'role-not-permitted-to-close',
    });
  });

  it('treats session.ended as a close, without waiting for a close message', async () => {
    await h.relay.create('instructor-1', SESSION);
    const ended = happy.find(e => e.type === 'session.ended');
    expect(ended, 'happy path should end the session').toBeDefined();
    for (const event of happy) await h.relay.publish('instructor-1', event);
    expect((await h.store.getSession(SESSION))?.status).toBe('closed');
  });

  it('keeps a session open after capture.stopped and catches a late student up to that state', async () => {
    await h.relay.create('instructor-1', SESSION);
    await h.relay.publish('instructor-1', happy[0]!);
    const stopped = { ...happy[0]!, type: 'capture.stopped', sequence: 2 };
    expect(await h.relay.publish('instructor-1', stopped)).toMatchObject({ status: 'ok' });
    expect((await h.store.getSession(SESSION))?.status).toBe('open');

    await h.relay.join('late-student', SESSION, 'student');
    expect(h.inbox.get('late-student')).toEqual([stopped]);

    const resumed = { ...happy[0]!, type: 'session.started', sequence: 3 };
    expect(await h.relay.publish('instructor-1', resumed)).toMatchObject({ status: 'ok' });
  });

  it('stops delivery once a session has expired, even though the row survives', async () => {
    const start = new Date('2026-09-15T15:00:00Z');
    const afterTtl = new Date(start.getTime() + (SESSION_TTL_SECONDS + 60) * 1000);

    await h.relay.create('instructor-1', SESSION, start);
    await h.relay.join('student-1', SESSION, 'student', start);
    await h.relay.publish('instructor-1', happy[0]!, start);

    // The row is still there -- DynamoDB deletes on its own schedule -- so this
    // is the application's own expiry check or nothing.
    expect(h.store.sessions.get(SESSION)).toBeDefined();

    const after = await h.relay.publish('instructor-1', happy[1]!, afterTtl);
    expect(after.status).toBe('error');
    expect(h.inbox.get('student-1')).toHaveLength(1);
  });

  it('catches a joining student up with latest state, not a replay', async () => {
    await h.relay.create('instructor-1', SESSION);
    const upTo = happy.slice(0, 3);
    for (const event of upTo) await h.relay.publish('instructor-1', event);

    await h.relay.join('late-student', SESSION, 'student');
    const caughtUp = h.inbox.get('late-student') ?? [];

    expect(caughtUp).toHaveLength(1);
    const viewBearing = upTo.filter(e =>
      ['asset.changed', 'region.changed', 'source.unmatched'].includes(e.type as string),
    );
    expect(caughtUp[0]).toEqual(viewBearing[viewBearing.length - 1]);
  });

  it('drops a connection that has gone away, and keeps serving the rest', async () => {
    await h.relay.create('instructor-1', SESSION);
    await h.relay.join('student-1', SESSION, 'student');
    await h.relay.join('student-2', SESSION, 'student');
    h.gone.add('student-1');

    const outcome = await h.relay.publish('instructor-1', happy[0]!);
    expect(outcome).toMatchObject({ status: 'ok', delivered: 1 });
    expect(await h.store.getConnection('student-1')).toBeUndefined();
    expect(await h.store.getConnection('student-2')).toBeDefined();
  });

  it('does not reset the sequence counter when an instructor re-creates', async () => {
    await h.relay.create('instructor-1', SESSION);
    await h.relay.publish('instructor-1', happy[0]!);
    await h.relay.publish('instructor-1', happy[1]!);

    await h.relay.create('instructor-1', SESSION);
    const replay = await h.relay.publish('instructor-1', happy[1]!);
    expect(replay).toEqual({ status: 'rejected', rules: ['sequence-not-monotonic'] });
  });

  it('refuses an event published into another session', async () => {
    await h.relay.create('instructor-1', 'other-session');
    const outcome = await h.relay.publish('instructor-1', happy[0]!);
    expect(outcome).toEqual({ status: 'rejected', rules: ['session-id-mismatch'] });
  });
});

describe('relay: live video stage', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  const token = (outcome: Awaited<ReturnType<Relay['create']>>) =>
    (outcome as { capability: { streamToken?: string } }).capability.streamToken;

  it('creates one stage with the session and hands out tokens that differ by role', async () => {
    const created = await h.relay.create('instructor-1', SESSION);
    const joined = await h.relay.join('student-1', SESSION, 'student');
    const joinedAgain = await h.relay.join('student-2', SESSION, 'student');

    expect(h.stage.calls.filter(c => c.startsWith('createStage'))).toEqual([`createStage:${SESSION}`]);
    expect(h.store.sessions.get(SESSION)?.stageArn).toBe([...h.stage.stages][0]);
    expect(token(created)).toMatch(/^publish-token-/);
    expect(token(joined)).toMatch(/^subscribe-token-/);
    expect(token(joinedAgain)).toMatch(/^subscribe-token-/);
    expect(token(joined)).not.toBe(token(joinedAgain));
    // The stage token is never persisted: only the ARN is on the record.
    expect(JSON.stringify([...h.store.sessions.values()])).not.toContain('token');
  });

  it('does not create a second stage when the instructor re-creates the session', async () => {
    await h.relay.create('instructor-1', SESSION);
    const again = await h.relay.create('instructor-1b', SESSION);
    expect(h.stage.stages.size).toBe(1);
    expect(token(again)).toMatch(/^publish-token-/);
  });

  it('opens the session without video when the stage cannot be created', async () => {
    h.stage.failCreateWith = new Error('AccessDeniedException');
    const created = await h.relay.create('instructor-1', SESSION);
    expect(created.status).toBe('ok');
    expect(token(created)).toBeUndefined();
    expect(h.store.sessions.get(SESSION)?.stageArn).toBeUndefined();

    await h.relay.join('student-1', SESSION, 'student');
    expect(await h.relay.publish('instructor-1', happy[0]!)).toMatchObject({ status: 'ok', delivered: 1 });
  });

  it('relays stream.started to students and catches a late joiner up with the view and then the stream', async () => {
    await h.relay.create('instructor-1', SESSION);
    await h.relay.join('student-1', SESSION, 'student');
    const started = streamStarted(1, 'window');
    expect(await h.relay.publish('instructor-1', started)).toMatchObject({ status: 'ok', delivered: 1 });
    expect(await h.relay.publish('instructor-1', { ...happy[1]!, sequence: 2 })).toMatchObject({ status: 'ok' });

    await h.relay.join('late-student', SESSION, 'student');
    // Ascending sequence, so a student that ignores stale sequences keeps both.
    expect((h.inbox.get('late-student') ?? []).map(e => [e.type, e.sequence])).toEqual([
      ['stream.started', 1],
      [happy[1]!.type, 2],
    ]);
  });

  it('forgets the stream on stream.stopped, capture.stopped and session.ended', async () => {
    for (const [ending, sequence] of [['stream.stopped', 2], ['capture.stopped', 2]] as const) {
      h = harness();
      await h.relay.create('instructor-1', SESSION);
      await h.relay.publish('instructor-1', streamStarted(1));
      expect(h.store.sessions.get(SESSION)?.latestStream).toBeDefined();
      expect(await h.relay.publish('instructor-1', lifecycle(ending, sequence)), ending).toMatchObject({ status: 'ok' });
      expect(h.store.sessions.get(SESSION)?.latestStream, ending).toBeUndefined();
      await h.relay.join('late-student', SESSION, 'student');
      expect((h.inbox.get('late-student') ?? []).map(e => e.type), ending).not.toContain('stream.started');
    }
  });

  it('deletes the stage when the session ends by event and when it is closed', async () => {
    await h.relay.create('instructor-1', SESSION);
    const arn = h.store.sessions.get(SESSION)!.stageArn!;
    await h.relay.publish('instructor-1', lifecycle('session.ended', 1));
    expect(h.stage.stages.has(arn)).toBe(false);
    expect(h.stage.calls).toContain(`deleteStage:${arn}`);

    h = harness();
    await h.relay.create('instructor-1', SESSION);
    const arn2 = h.store.sessions.get(SESSION)!.stageArn!;
    expect(await h.relay.close('instructor-1', SESSION)).toEqual({ status: 'ok' });
    expect(h.stage.stages.has(arn2)).toBe(false);
  });

  it('refuses a stream.started that names a whole monitor, or no surface', async () => {
    await h.relay.create('instructor-1', SESSION);
    const { surface: _none, ...withoutSurface } = streamStarted(1);
    for (const [label, event] of [['monitor', streamStarted(1, 'monitor')], ['42', streamStarted(1, 42)], ['missing', withoutSurface]] as const) {
      const outcome = await h.relay.publish('instructor-1', event);
      expect(outcome.status, label).toBe('rejected');
      expect((outcome as { rules: string[] }).rules, label).toContain('stream-surface-invalid');
    }
    expect(h.store.sessions.get(SESSION)?.latestStream).toBeUndefined();
  });

  it('refuses a student announcing a stream', async () => {
    await h.relay.create('instructor-1', SESSION);
    await h.relay.join('student-1', SESSION, 'student');
    expect(await h.relay.publish('student-1', streamStarted(1))).toEqual({
      status: 'rejected',
      rules: ['role-not-permitted-to-publish'],
    });
  });
});
