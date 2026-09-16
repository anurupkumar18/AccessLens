import { ApiHttpError, withErrors } from './http';
import type { ApiEvent, ApiResult } from './types';

/**
 * Who is calling the authoring API. API Gateway's JWT authorizer has already
 * verified the Google ID token (issuer, audience, signature, expiry) before
 * the Lambda runs; this module reads the claims it forwarded. Two roles
 * exist (D13): students never call this API at all, and anyone who signs in
 * with a verified Google account is an instructor. No student record is
 * ever involved; the only identity stored is the instructor's own.
 */
export interface Caller {
  /** Google's stable subject id for the account. */
  readonly sub: string;
  /** Verified, lower-cased account email. */
  readonly email: string;
  /** Google's display name when the token carries one. */
  readonly name?: string;
}

export type InstructorHandler = (event: ApiEvent, caller: Caller) => Promise<ApiResult>;

function claim(claims: Record<string, unknown> | undefined, name: string): string | undefined {
  const value = claims?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** The signed-in instructor, or 401/403 as `ApiHttpError`. */
export function callerOf(event: ApiEvent): Caller {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  const sub = claim(claims, 'sub');
  const email = claim(claims, 'email');
  if (!sub || !email) throw new ApiHttpError(401, 'not_signed_in', 'Sign in with Google to use the authoring API.');
  const verified = claims?.email_verified === true || claims?.email_verified === 'true';
  if (!verified) throw new ApiHttpError(403, 'email_not_verified', `${email} is not a verified Google account.`);
  const name = claim(claims, 'name');
  return { sub, email: email.toLowerCase(), ...(name ? { name } : {}) };
}

/** `withErrors` plus the sign-in gate; every route except health uses it. */
export function withInstructor(handler: InstructorHandler) {
  return withErrors(event => handler(event, callerOf(event)));
}
