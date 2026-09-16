import { describe, it, expect } from 'vitest';
import { callerOf, isAllowed, parseAllowlist, withInstructor } from './identity';
import { json } from './http';
import type { ApiEvent } from './types';

const signedIn = (claims: Record<string, unknown>): ApiEvent => ({ requestContext: { authorizer: { jwt: { claims } } } });
const prof = { sub: '1234567890', email: 'Prof@Uni.edu', email_verified: 'true' };

describe('instructor allowlist', () => {
  it('parses emails and @domains, ignoring case, spaces and empties', () => {
    expect(parseAllowlist(' Prof@Uni.edu, @cs.uni.edu ,, ')).toEqual(['prof@uni.edu', '@cs.uni.edu']);
    expect(parseAllowlist(undefined)).toEqual([]);
  });

  it('matches an exact email or a whole domain, never a suffix', () => {
    const list = parseAllowlist('prof@uni.edu,@cs.uni.edu');
    expect(isAllowed('PROF@uni.edu', list)).toBe(true);
    expect(isAllowed('ta@cs.uni.edu', list)).toBe(true);
    expect(isAllowed('ta@uni.edu', list)).toBe(false);
    expect(isAllowed('x@evilcs.uni.edu', list)).toBe(false);
    expect(isAllowed('prof@uni.edu.attacker.com', list)).toBe(false);
    expect(isAllowed('not-an-email', list)).toBe(false);
  });

  it('an empty allowlist admits nobody', () => {
    expect(() => callerOf(signedIn(prof), [])).toThrow(expect.objectContaining({ statusCode: 403, code: 'not_an_instructor' }));
  });
});

describe('callerOf', () => {
  const list = parseAllowlist('prof@uni.edu');

  it('returns the Google subject and lower-cased email of an allowed, verified account', () => {
    expect(callerOf(signedIn(prof), list)).toEqual({ sub: '1234567890', email: 'prof@uni.edu' });
    expect(callerOf(signedIn({ ...prof, email_verified: true }), list).sub).toBe('1234567890');
  });

  it('is 401 when the gateway forwarded no identity (misconfigured route)', () => {
    expect(() => callerOf({}, list)).toThrow(expect.objectContaining({ statusCode: 401, code: 'not_signed_in' }));
    expect(() => callerOf(signedIn({ email: 'prof@uni.edu' }), list)).toThrow(expect.objectContaining({ statusCode: 401 }));
  });

  it('is 403 for an unverified email or an account off the list', () => {
    expect(() => callerOf(signedIn({ ...prof, email_verified: 'false' }), list)).toThrow(expect.objectContaining({ statusCode: 403 }));
    expect(() => callerOf(signedIn({ ...prof, email: 'student@uni.edu' }), list)).toThrow(expect.objectContaining({ statusCode: 403 }));
  });
});

describe('withInstructor', () => {
  it('passes the caller to the handler and turns identity failures into JSON errors', async () => {
    process.env.INSTRUCTOR_ALLOWLIST = 'prof@uni.edu';
    const handler = withInstructor(async (_event, caller) => json(200, { hello: caller.email }));
    expect(JSON.parse((await handler(signedIn(prof))).body ?? '')).toEqual({ hello: 'prof@uni.edu' });
    const denied = await handler(signedIn({ ...prof, email: 'someone@else.org' }));
    expect(denied.statusCode).toBe(403);
    expect(JSON.parse(denied.body ?? '').error.code).toBe('not_an_instructor');
    expect((await handler({})).statusCode).toBe(401);
    delete process.env.INSTRUCTOR_ALLOWLIST;
  });
});
