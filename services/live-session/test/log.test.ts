/**
 * The redaction guarantee, asserted rather than trusted.
 *
 * `SYSTEM_DESIGN.md` §7 promises CloudWatch gets redacted telemetry with field
 * allowlists. This test is what makes that promise survive the next person who
 * adds a field to `LiveEvent`: a new content-bearing field is not logged unless
 * someone deliberately adds it to the allowlist, and if they do, the last test
 * here fails and asks them to justify it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logEvent, REDACTION_ALLOWLIST } from '../src/log.js';

const EVENT = {
  schemaVersion: '1.0',
  type: 'region.changed',
  sessionId: 'sess-demo-0001',
  packId: 'bio-cell-demo',
  packVersion: 1,
  sequence: 4,
  sentAt: '2026-09-15T15:00:24Z',
  assetId: 'cell-slide-03',
  regionId: 'mitochondrion',
  pointer: { x: 0.42, y: 0.58 },
  arState: { hotspotId: 'cell-slide-03:mitochondrion', action: 'focus' },
  caption: 'The mitochondrion releases energy the cell can use.',
};

const captured = () => {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  return {
    spy,
    line: () => String(spy.mock.calls.at(-1)?.[0] ?? ''),
  };
};

afterEach(() => vi.restoreAllMocks());

describe('redacted logging', () => {
  it('logs the operational fields', () => {
    const { line } = captured();
    logEvent('info', 'event-relayed', EVENT, { delivered: 2 });
    const parsed = JSON.parse(line());
    expect(parsed).toMatchObject({
      level: 'info',
      message: 'event-relayed',
      type: 'region.changed',
      sessionId: 'sess-demo-0001',
      sequence: 4,
      delivered: 2,
    });
  });

  it('never logs lesson content', () => {
    const { line } = captured();
    logEvent('info', 'event-relayed', EVENT);
    const raw = line();

    // Checked as substrings of the raw line, not as absent keys: a nested
    // object would satisfy a key check while still putting the caption in
    // CloudWatch.
    for (const secret of [
      'mitochondrion',
      'cell-slide-03',
      'releases energy',
      '0.42',
      'focus',
    ]) {
      expect(raw, `leaked ${secret}`).not.toContain(secret);
    }

    const parsed = JSON.parse(raw);
    for (const field of ['assetId', 'regionId', 'pointer', 'arState', 'caption']) {
      expect(parsed).not.toHaveProperty(field);
    }
  });

  it('survives an event carrying a field nobody anticipated', () => {
    const { line } = captured();
    logEvent('warn', 'event-rejected', {
      ...EVENT,
      frameData: 'data:image/png;base64,iVBORw0KGgo',
      studentId: 'u1529771',
    });
    const raw = line();
    expect(raw).not.toContain('iVBORw0KGgo');
    expect(raw).not.toContain('u1529771');
  });

  it('keeps the allowlist to operational fields only', () => {
    // If this fails, someone widened the allowlist. That may be right -- but it
    // is a charter-adjacent decision, so it should be a deliberate edit to this
    // list rather than a side effect.
    expect([...REDACTION_ALLOWLIST].sort()).toEqual(
      ['packId', 'packVersion', 'sequence', 'sessionId', 'type'].sort(),
    );
  });
});
