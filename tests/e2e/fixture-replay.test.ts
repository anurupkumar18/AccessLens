/**
 * Replays the reviewed pack's event fixtures through Part 1's real runtime.
 *
 * Part 5 owns `tests/e2e/`. This is the first slice of it that can run: the
 * student renderers do not exist yet, but `InMemorySessionClient` does, so the
 * path from a checked-in fixture to a subscriber receiving a validated event
 * is testable today.
 *
 * Two things this covers that nothing else does.
 *
 * 1. **Drift between the two validators.** `check_contract_conformance.py`
 *    reimplements a subset of JSON Schema in the standard library so it can run
 *    in the Python-only checks. A reimplementation drifts from the thing it
 *    imitates. This runs the same events through Zod -- the actual runtime
 *    authority -- and fails if the two ever disagree about a single event.
 *
 * 2. **Session lifecycle.** `close()` must stop delivery, which is the
 *    "instructor stops and student views freeze immediately" behaviour the
 *    runbook rehearses and charter A1 implies.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemorySessionClient, LiveEventSchema } from '../../apps/extension/src/shared/contracts';

const PACK = join(process.cwd(), 'packages/access-packs/bio-cell-demo');
const FIXTURES = join(PACK, 'fixtures');

interface Fixture {
  scenario: string;
  events: Record<string, unknown>[];
  redeliveredEventIndices?: number[];
  expectations: string[];
}

interface Verdict {
  fixture: string;
  index: number;
  sequence: number;
  type: string;
  gaps: string[];
}

const scenarios: Fixture[] = readdirSync(FIXTURES)
  .filter(name => name.endsWith('.json'))
  .sort()
  .map(name => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Fixture);

/**
 * Events the shared contract rejects today, and why. Not a workaround -- kept
 * as an explicit allowlist so a new gap cannot appear silently. T-16 (the
 * `caption.appended` payload) closed on 2026-09-16: `caption.appended` now
 * carries `assetId` and `caption: {text, isFinal}`, so every fixture event is
 * expected to validate.
 */
const KNOWN_REJECTED = new Set<string>([]);

const key = (scenario: string, event: Record<string, unknown>) => `${scenario}#${event.sequence}`;

describe('fixture replay through InMemorySessionClient', () => {
  it('accepts every event in the fixtures', () => {
    const rejected = new Set<string>();
    for (const fixture of scenarios) {
      for (const event of fixture.events) {
        if (!LiveEventSchema.safeParse(event).success) rejected.add(key(fixture.scenario, event));
      }
    }
    expect([...rejected].sort()).toEqual([...KNOWN_REJECTED].sort());
  });

  it('agrees with the Python conformance checker on every single event', () => {
    const raw = execFileSync(
      'python3',
      [join(PACK, 'tools/check_contract_conformance.py'), '--json'],
      { encoding: 'utf8' },
    );
    const verdicts: Verdict[] = JSON.parse(raw);
    expect(verdicts.length).toBeGreaterThan(0);

    const disagreements = verdicts.flatMap(verdict => {
      const fixture = scenarios.find(s => s.scenario === verdict.fixture);
      if (!fixture) return [`${verdict.fixture}: no such scenario loaded`];
      const event = fixture.events[verdict.index];
      const zodAccepts = LiveEventSchema.safeParse(event).success;
      const pythonAccepts = verdict.gaps.length === 0;
      if (zodAccepts === pythonAccepts) return [];
      return [
        `${verdict.fixture} seq ${verdict.sequence} (${verdict.type}): ` +
          `zod ${zodAccepts ? 'accepts' : 'rejects'} but the JSON Schema checker ` +
          `${pythonAccepts ? 'accepts' : 'rejects'} it (${verdict.gaps.join(', ') || 'no gaps'})`,
      ];
    });
    expect(disagreements).toEqual([]);
  });

  it('delivers conforming events to a subscriber in order', async () => {
    const fixture = scenarios.find(s => s.scenario === 'happy-path')!;
    const client = new InMemorySessionClient();
    await client.create('sess-demo-0001');

    const received: number[] = [];
    client.subscribe(event => received.push(event.sequence));
    for (const event of fixture.events) client.send(event as never);

    expect(received).toEqual(fixture.events.map(e => e.sequence));
    client.close();
  });

  it('treats a reconnect redelivery as a no-op replay', async () => {
    const fixture = scenarios.find(s => s.scenario === 'reconnect-latest-state')!;
    const redelivered = fixture.redeliveredEventIndices ?? [];
    expect(redelivered.length).toBeGreaterThan(0);
    const first = Math.min(...redelivered);

    const client = new InMemorySessionClient();
    await client.join('sess-demo-0001');

    // What a Focus renderer keeps: the last asset and region it was told about.
    // Events that name neither (session lifecycle, capture pause) leave it alone.
    let state: { assetId?: string; regionId?: string } = {};
    client.subscribe(event => {
      if (event.type === 'asset.changed' || event.type === 'region.changed') {
        state = { assetId: event.assetId, regionId: (event as { regionId?: string }).regionId };
      }
    });

    // Replay up to the point the redelivery actually arrives, not past it.
    for (const event of fixture.events.slice(0, first)) client.send(event as never);
    const before = JSON.stringify(state);
    expect(before).not.toBe('{}');

    client.send(fixture.events[first] as never);
    expect(JSON.stringify(state)).toBe(before);
    client.close();
  });

  it('stops delivering once the session is closed', async () => {
    const fixture = scenarios.find(s => s.scenario === 'pause-resume-stop')!;
    const client = new InMemorySessionClient();
    await client.create('sess-demo-0001');

    let delivered = 0;
    client.subscribe(() => { delivered += 1; });
    client.send(fixture.events[0] as never);
    expect(delivered).toBe(1);

    client.close();
    expect(() => client.send(fixture.events[1] as never)).toThrow();
    expect(delivered).toBe(1);
  });

  it('rejects a capability request after close', async () => {
    const client = new InMemorySessionClient();
    client.close();
    await expect(client.create('sess-demo-0001')).rejects.toThrow();
  });

  it('every scenario states what a consumer must do with it', () => {
    for (const fixture of scenarios) {
      expect(fixture.expectations.length, fixture.scenario).toBeGreaterThan(0);
    }
  });
});

describe('negative fixtures are actually rejected', () => {
  interface InvalidVerdict {
    fixture: string;
    expectedRule: string;
    broken: string[];
    event: Record<string, unknown>;
  }

  const verdicts: InvalidVerdict[] = JSON.parse(
    execFileSync('python3', [join(PACK, 'tools/reference_event_check.py')], { encoding: 'utf8' }),
  );

  it('loads every negative fixture', () => {
    expect(verdicts.length).toBeGreaterThanOrEqual(10);
  });

  it('rejects every one of them, by shape or by pack consistency', () => {
    /**
     * A negative fixture that nothing rejects is a test asserting nothing. Each
     * must fail either Zod (wrong shape for its event type) or the pack-aware
     * rules (names something this pack does not contain, or moves the stream
     * backwards) -- a distinction JSON Schema cannot make, because it cannot
     * see the pack.
     */
    const unrejected = verdicts.filter(
      v => LiveEventSchema.safeParse(v.event).success && v.broken.length === 0,
    );
    expect(unrejected.map(v => v.fixture)).toEqual([]);
  });

  it('each one trips the specific rule it documents', () => {
    for (const verdict of verdicts) {
      const zodRejects = !LiveEventSchema.safeParse(verdict.event).success;
      const documented = verdict.broken.includes(verdict.expectedRule);
      expect(
        documented || zodRejects,
        `${verdict.fixture} claims rule "${verdict.expectedRule}" but tripped [${verdict.broken}]`,
      ).toBe(true);
    }
  });

  it('records which rejections need pack awareness, for Part 4', () => {
    /**
     * Part 4 validates server-side against the JSON Schema, where there is no
     * reviewed pack and no per-session stream state to consult. These four are
     * rejections the relay cannot make from the schema alone.
     *
     * `pack-version-mismatch` is the one worth noticing: the schema types
     * `packVersion` as any positive integer, so a stale version passes cleanly.
     * SYSTEM_DESIGN section 9 requires rendering to stop and refetch when the
     * pack version differs, so somebody has to hold the session's expected
     * version and compare. If the relay does not, every student renderer must.
     */
    const needsPackOrStream = verdicts
      .filter(v => LiveEventSchema.safeParse(v.event).success)
      .map(v => v.fixture)
      .sort();
    expect(needsPackOrStream).toEqual([
      'hotspot-region-mismatch',
      'non-monotonic-sequence',
      'pack-version-mismatch',
      'unknown-region',
    ]);
  });

  it('the schema alone still catches every prohibited-field case', () => {
    /** Charter A2 and A7 must not depend on anyone loading the pack. */
    for (const name of [
      'raw-frame-payload',
      'prohibited-mastery-signal',
      'prohibited-student-identity',
      'student-published-instructor-event',
    ]) {
      const verdict = verdicts.find(v => v.fixture === name)!;
      expect(LiveEventSchema.safeParse(verdict.event).success, name).toBe(false);
    }
  });
});
