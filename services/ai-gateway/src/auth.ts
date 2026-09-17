import { verifyCapability, type Role } from '../../live-session/src/capability.js';

export type Authorized = { ok: true; role: Role; sessionId: string };
export type Refused = { ok: false; status: 401 | 403; reason: string };

/**
 * Every AI route requires the role capability the relay issued when this
 * client created or joined a live session, signed with the same secret. So
 * only people in a live AccessLens session can spend model calls, only an
 * instructor can open a microphone stream, and the capability still carries no
 * identity: a role in a session and an expiry, nothing else (charter A4, A5).
 */
export function authorize(capability: unknown, secret: string, allowed: readonly Role[], now: Date = new Date()): Authorized | Refused {
  const sessionId = typeof capability === 'object' && capability !== null ? (capability as { sessionId?: unknown }).sessionId : undefined;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return { ok: false, status: 401, reason: 'capability-malformed' };
  const verdict = verifyCapability(capability, sessionId, secret, now);
  if (!verdict.ok) return { ok: false, status: 401, reason: verdict.reason };
  if (!allowed.includes(verdict.role)) return { ok: false, status: 403, reason: 'role-not-permitted' };
  return { ok: true, role: verdict.role, sessionId };
}
