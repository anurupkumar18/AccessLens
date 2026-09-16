/**
 * The relay's validator must agree with Part 5's reference, event for event.
 *
 * `reference_event_check.py` says: "Keep the rule names stable: Part 4 has to
 * enforce the same rules server-side." A comment asking for that is a hope. This
 * runs both implementations over every reviewed fixture -- six ordered scenarios
 * plus eleven single-fault negatives -- and fails on any disagreement, including
 * the order the rules come back in.
 *
 * Why it matters beyond tidiness: Part 2 tests its matcher against the Python
 * rules, and the relay is what actually refuses events in the demo. If the two
 * drift, Part 2 passes locally and the same event is rejected live, which is the
 * worst possible time to find out.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkEvent, indexPack } from '../src/rules.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const packPath = join(repoRoot, 'packages/access-packs/bio-cell-demo/pack.json');

interface Verdict {
  source: string;
  event: Record<string, unknown>;
  lastSequence: number;
  expectedRule?: string;
  broken: string[];
}

const pack = indexPack(JSON.parse(readFileSync(packPath, 'utf8')));

const verdicts: Verdict[] = JSON.parse(
  execFileSync('python3', [join(here, 'reference_verdicts.py')], { encoding: 'utf8' }),
);

describe('server-side rules match Part 5 reference', () => {
  it('has fixtures to check', () => {
    // A parity test over an empty list passes while proving nothing.
    expect(verdicts.length).toBeGreaterThan(40);
    expect(verdicts.some(v => v.source.startsWith('invalid/'))).toBe(true);
  });

  it('agrees on every fixture event, rule names and order included', () => {
    const disagreements = verdicts
      .map(verdict => ({
        source: verdict.source,
        python: verdict.broken,
        // No role and no session status: this compares the shared rules only,
        // which is exactly the surface the Python reference covers.
        typescript: checkEvent(verdict.event, pack, { lastSequence: verdict.lastSequence }),
      }))
      .filter(row => JSON.stringify(row.python) !== JSON.stringify(row.typescript));

    expect(disagreements).toEqual([]);
  });

  it('trips the documented rule for each negative fixture', () => {
    const negatives = verdicts.filter(v => v.expectedRule !== undefined);
    expect(negatives).toHaveLength(11);

    const misses = negatives
      .map(v => ({
        source: v.source,
        expected: v.expectedRule,
        got: checkEvent(v.event, pack, { lastSequence: v.lastSequence }),
      }))
      .filter(row => !row.got.includes(row.expected as string));

    expect(misses).toEqual([]);
  });

  it('accepts the happy path outright', () => {
    // The negatives prove the relay refuses things. This proves it does not
    // refuse everything, which is the failure mode a strict validator reaches
    // by accident.
    const happy = verdicts.filter(v => v.source.startsWith('happy-path#'));
    expect(happy.length).toBeGreaterThan(0);
    for (const verdict of happy) {
      expect(checkEvent(verdict.event, pack, { lastSequence: verdict.lastSequence })).toEqual([]);
    }
  });
});
