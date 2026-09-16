/**
 * Short-lived, role-scoped capabilities (A6).
 *
 * The shared contract (`RoleCapabilitySchema`) fixes the shape and calls the
 * `token` opaque; Part 4 owns what goes inside it. This is that.
 *
 * Design constraints, all from the charter and system design rather than from
 * convenience:
 *
 *   - **No identity.** The token commits to a session, a role, and an expiry.
 *     It deliberately cannot answer "which student is this", because nothing in
 *     AccessLens is allowed to ask (charter A6, A7). A connection is a role in
 *     a session and nothing more.
 *   - **Short-lived.** A capability outlives neither the session nor its TTL.
 *     Closing a session invalidates delivery immediately; expiry is the backstop
 *     for a session nobody closed.
 *   - **Verified, not trusted.** The token is HMAC-SHA256 over the canonical
 *     fields. A client that edits `role` from `student` to `instructor` in the
 *     JSON it sends produces a signature that no longer matches, and the relay
 *     refuses it. Without this, `role-not-permitted-to-publish` in `rules.ts`
 *     would be advice rather than enforcement.
 *
 * HMAC rather than KMS asymmetric signing: the only verifier is the relay
 * itself, so a shared secret is the right shape, and it keeps verification to
 * a local computation rather than a KMS call on the hot path of every event.
 * `SYSTEM_DESIGN.md`'s KMS row is about published-pack integrity, which has a
 * different verifier (student clients) and therefore a different answer.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type Role = 'instructor' | 'student';

export interface RoleCapability {
  schemaVersion: '1.0';
  sessionId: string;
  role: Role;
  issuedAt: string;
  expiresAt: string;
  token: string;
}

/** Capability lifetime. Sessions are a class period; this is deliberately longer
 *  than a demo and far shorter than a day. */
export const CAPABILITY_TTL_SECONDS = 4 * 60 * 60;

/**
 * The exact bytes the signature covers.
 *
 * Every field the relay later trusts has to be in here. `role` is the one that
 * matters most -- it is the whole authorization decision -- but `expiresAt` is
 * just as load-bearing: if it were unsigned, a client could extend its own
 * capability indefinitely by editing one string.
 */
function payload(sessionId: string, role: Role, issuedAt: string, expiresAt: string): string {
  return ['v1', sessionId, role, issuedAt, expiresAt].join('\n');
}

function sign(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message, 'utf8').digest('base64url');
}

export function issueCapability(
  sessionId: string,
  role: Role,
  secret: string,
  now: Date = new Date(),
): RoleCapability {
  const issuedAt = new Date(Math.floor(now.getTime() / 1000) * 1000).toISOString();
  const expiresAt = new Date(
    Math.floor(now.getTime() / 1000) * 1000 + CAPABILITY_TTL_SECONDS * 1000,
  ).toISOString();
  return {
    schemaVersion: '1.0',
    sessionId,
    role,
    issuedAt,
    expiresAt,
    token: sign(secret, payload(sessionId, role, issuedAt, expiresAt)),
  };
}

export type VerifyFailure =
  | 'capability-malformed'
  | 'capability-signature-invalid'
  | 'capability-expired'
  | 'capability-session-mismatch';

export type VerifyResult =
  | { ok: true; role: Role }
  | { ok: false; reason: VerifyFailure };

/**
 * Verify a capability against a session.
 *
 * Order matters for what an attacker learns: the signature is checked before
 * the expiry, so a forged token is reported as forged rather than as expired.
 */
export function verifyCapability(
  capability: unknown,
  expectedSessionId: string,
  secret: string,
  now: Date = new Date(),
): VerifyResult {
  if (typeof capability !== 'object' || capability === null) {
    return { ok: false, reason: 'capability-malformed' };
  }
  const { sessionId, role, issuedAt, expiresAt, token } = capability as Record<string, unknown>;
  if (
    typeof sessionId !== 'string' ||
    (role !== 'instructor' && role !== 'student') ||
    typeof issuedAt !== 'string' ||
    typeof expiresAt !== 'string' ||
    typeof token !== 'string'
  ) {
    return { ok: false, reason: 'capability-malformed' };
  }

  const expected = sign(secret, payload(sessionId, role, issuedAt, expiresAt));
  const given = Buffer.from(token, 'base64url');
  const want = Buffer.from(expected, 'base64url');
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return { ok: false, reason: 'capability-signature-invalid' };
  }

  // Only meaningful once the signature holds -- before that, these fields are
  // attacker-controlled and mean nothing.
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now.getTime()) {
    return { ok: false, reason: 'capability-expired' };
  }
  if (sessionId !== expectedSessionId) {
    return { ok: false, reason: 'capability-session-mismatch' };
  }

  return { ok: true, role };
}
