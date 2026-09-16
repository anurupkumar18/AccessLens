import { describe, it, expect } from 'vitest';
import { callerOf, withInstructor } from './identity';
import { json } from './http';
import type { ApiEvent } from './types';

const signedIn = (claims: Record<string, unknown>): ApiEvent => ({ requestContext: { authorizer: { jwt: { claims } } } });
const prof = { sub: '1234567890', email: 'Prof@Uni.edu', email_verified: 'true', name: 'Prof Example' };

describe('callerOf', () => {
  it('returns the Google subject, lower-cased email and name of a verified account', () => {
    expect(callerOf(signedIn(prof))).toEqual({ sub: '1234567890', email: 'prof@uni.edu', name: 'Prof Example' });
    expect(callerOf(signedIn({ sub: 's', email: 'a@b.c', email_verified: true }))).toEqual({ sub: 's', email: 'a@b.c' });
  });

  it('is 401 when the gateway forwarded no identity (misconfigured route)', () => {
    expect(() => callerOf({})).toThrow(expect.objectContaining({ statusCode: 401, code: 'not_signed_in' }));
    expect(() => callerOf(signedIn({ email: 'prof@uni.edu' }))).toThrow(expect.objectContaining({ statusCode: 401 }));
  });

  it('is 403 for an unverified email', () => {
    expect(() => callerOf(signedIn({ ...prof, email_verified: 'false' }))).toThrow(expect.objectContaining({ statusCode: 403, code: 'email_not_verified' }));
    expect(() => callerOf(signedIn({ sub: 's', email: 'a@b.c' }))).toThrow(expect.objectContaining({ statusCode: 403 }));
  });
});

describe('withInstructor', () => {
  it('passes the caller to the handler and turns identity failures into JSON errors', async () => {
    const handler = withInstructor(async (_event, caller) => json(200, { hello: caller.email }));
    expect(JSON.parse((await handler(signedIn(prof))).body ?? '')).toEqual({ hello: 'prof@uni.edu' });
    const denied = await handler(signedIn({ ...prof, email_verified: 'false' }));
    expect(denied.statusCode).toBe(403);
    expect(JSON.parse(denied.body ?? '').error.code).toBe('email_not_verified');
    expect((await handler({})).statusCode).toBe(401);
  });
});
