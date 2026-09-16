/**
 * Capabilities are the whole authorization story, so the tests are mostly
 * about what a capability must *refuse* to do.
 *
 * The role check in `rules.ts` reads `connection.role`, which the relay set
 * from a capability. If a capability can be edited, that check is decoration.
 */
import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_TTL_SECONDS,
  issueCapability,
  verifyCapability,
} from '../src/capability.js';

const SECRET = 'test-secret-not-a-real-one';
const SESSION = 'sess-demo-0001';
const T0 = new Date('2026-09-15T15:00:00Z');

describe('capability', () => {
  it('round-trips a capability it issued', () => {
    const capability = issueCapability(SESSION, 'instructor', SECRET, T0);
    expect(verifyCapability(capability, SESSION, SECRET, T0)).toEqual({
      ok: true,
      role: 'instructor',
    });
  });

  it('matches the shape the shared contract freezes', () => {
    const capability = issueCapability(SESSION, 'student', SECRET, T0);
    expect(Object.keys(capability).sort()).toEqual(
      ['expiresAt', 'issuedAt', 'role', 'schemaVersion', 'sessionId', 'token'].sort(),
    );
    expect(capability.schemaVersion).toBe('1.0');
    // RoleCapabilitySchema requires `z.string().datetime()`, which rejects a
    // timestamp carrying milliseconds' worth of extra precision in some forms;
    // issuing on whole seconds keeps the two sides agreeing.
    expect(capability.issuedAt).toBe('2026-09-15T15:00:00.000Z');
  });

  it('carries no identity', () => {
    // Charter A6/A7: a capability says what may be done in a session, never by
    // whom. A future field named anything like a user is a contract change, not
    // a detail.
    const capability = issueCapability(SESSION, 'student', SECRET, T0) as unknown as Record<string, unknown>;
    for (const key of Object.keys(capability)) {
      expect(key).not.toMatch(/user|student|person|name|email|identity|subject/i);
    }
  });

  it('refuses a capability whose role was edited', () => {
    const capability = issueCapability(SESSION, 'student', SECRET, T0);
    const escalated = { ...capability, role: 'instructor' as const };
    expect(verifyCapability(escalated, SESSION, SECRET, T0)).toEqual({
      ok: false,
      reason: 'capability-signature-invalid',
    });
  });

  it('refuses a capability whose expiry was extended', () => {
    const capability = issueCapability(SESSION, 'student', SECRET, T0);
    const extended = { ...capability, expiresAt: '2099-01-01T00:00:00.000Z' };
    expect(verifyCapability(extended, SESSION, SECRET, T0)).toEqual({
      ok: false,
      reason: 'capability-signature-invalid',
    });
  });

  it('refuses a capability once it has expired', () => {
    const capability = issueCapability(SESSION, 'student', SECRET, T0);
    const later = new Date(T0.getTime() + (CAPABILITY_TTL_SECONDS + 1) * 1000);
    expect(verifyCapability(capability, SESSION, SECRET, later)).toEqual({
      ok: false,
      reason: 'capability-expired',
    });
  });

  it('refuses a valid capability presented for a different session', () => {
    const capability = issueCapability(SESSION, 'student', SECRET, T0);
    expect(verifyCapability(capability, 'other-session', SECRET, T0)).toEqual({
      ok: false,
      reason: 'capability-session-mismatch',
    });
  });

  it('refuses a capability signed with a different secret', () => {
    const capability = issueCapability(SESSION, 'instructor', 'other-secret', T0);
    expect(verifyCapability(capability, SESSION, SECRET, T0)).toEqual({
      ok: false,
      reason: 'capability-signature-invalid',
    });
  });

  it('refuses junk without throwing', () => {
    for (const junk of [null, undefined, 'token', 42, {}, { role: 'instructor' }]) {
      expect(verifyCapability(junk, SESSION, SECRET, T0)).toEqual({
        ok: false,
        reason: 'capability-malformed',
      });
    }
  });

  it('reports a forged token as forged rather than as expired', () => {
    // Order-of-checks detail: an attacker learns "your signature is wrong",
    // not "your signature is wrong and also here is when it would expire".
    const capability = issueCapability(SESSION, 'student', SECRET, T0);
    const forged = { ...capability, token: 'AAAA', expiresAt: '2000-01-01T00:00:00.000Z' };
    expect(verifyCapability(forged, SESSION, SECRET, T0)).toEqual({
      ok: false,
      reason: 'capability-signature-invalid',
    });
  });
});
