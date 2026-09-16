import { ApiHttpError, withErrors } from './http';
import type { ApiEvent, ApiResult } from './types';

/**
 * Who is calling the authoring API. API Gateway's JWT authorizer has already
 * verified the Google ID token (issuer, audience, signature, expiry) before
 * the Lambda runs; this module reads the claims it forwarded and applies the
 * deployment's instructor allowlist (D12). Nothing here is a student
 * record: only instructors sign in, and only their Google subject id is
 * stored, on the jobs they create.
 */
export interface Caller {
  /** Google's stable subject id for the account. */
  readonly sub: string;
  /** Verified, lower-cased account email. */
  readonly email: string;
}

export type InstructorHandler = (event: ApiEvent, caller: Caller) => Promise<ApiResult>;

/** `INSTRUCTOR_ALLOWLIST`: comma-separated emails and `@domain` entries. Empty means nobody. */
export function parseAllowlist(raw: string | undefined): readonly string[] {
  return (raw ?? '').split(',').map(entry => entry.trim().toLowerCase()).filter(entry => entry.length > 0);
}

export function isAllowed(email: string, allowlist: readonly string[]): boolean {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  if (at <= 0) return false;
  const domain = normalized.slice(at);
  return allowlist.some(entry => (entry.startsWith('@') ? entry === domain : entry === normalized));
}

function claim(claims: Record<string, unknown> | undefined, name: string): string | undefined {
  const value = claims?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** The signed-in instructor, or 401/403 as `ApiHttpError`. */
export function callerOf(event: ApiEvent, allowlist: readonly string[] = parseAllowlist(process.env.INSTRUCTOR_ALLOWLIST)): Caller {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  const sub = claim(claims, 'sub');
  const email = claim(claims, 'email');
  if (!sub || !email) throw new ApiHttpError(401, 'not_signed_in', 'Sign in with Google to use the authoring API.');
  const verified = claims?.email_verified === true || claims?.email_verified === 'true';
  if (!verified || !isAllowed(email, allowlist)) {
    throw new ApiHttpError(403, 'not_an_instructor', `${email} is not on this deployment's instructor list.`);
  }
  return { sub, email: email.toLowerCase() };
}

/** `withErrors` plus the instructor gate; every route except health uses it. */
export function withInstructor(handler: InstructorHandler) {
  return withErrors(event => handler(event, callerOf(event)));
}
