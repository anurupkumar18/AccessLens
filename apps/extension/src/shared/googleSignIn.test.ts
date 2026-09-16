// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { authorizationUrl, idTokenFromRedirect, readSession, sessionFromIdToken, signInWithExtension, writeSession } from './googleSignIn';

const b64url = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
const token = (payload: Record<string, unknown>) => `${b64url({ alg: 'RS256' })}.${b64url(payload)}.sig`;
const future = Math.floor(Date.now() / 1000) + 3600;

beforeEach(() => { window.localStorage.clear(); });

describe('Google session', () => {
  it('reads the email and expiry from the ID token without trusting anything else', () => {
    expect(sessionFromIdToken(token({ email: 'prof@uni.edu', exp: 1700000000 }))).toEqual({ idToken: expect.any(String), email: 'prof@uni.edu', expiresAt: 1700000000000 });
    expect(sessionFromIdToken('not.a.jwt')).toBeNull();
    expect(sessionFromIdToken(token({ exp: 1 }))).toBeNull();
    expect(sessionFromIdToken('a.b')).toBeNull();
  });

  it('keeps a session until it expires and then forgets it', () => {
    const session = sessionFromIdToken(token({ email: 'prof@uni.edu', exp: future }))!;
    writeSession(session);
    expect(readSession()?.email).toBe('prof@uni.edu');
    expect(readSession(session.expiresAt + 1)).toBeNull();
    expect(window.localStorage.getItem('accesslens.authoring.session')).toBeNull();
    writeSession(null);
    expect(readSession()).toBeNull();
  });
});

describe('extension sign-in', () => {
  it('asks Google for an ID token only and rejects a redirect whose state does not match', () => {
    const url = new URL(authorizationUrl({ clientId: 'cid', redirectUri: 'https://abc.chromiumapp.org/', nonce: 'n1', state: 's1' }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: 'cid', response_type: 'id_token', scope: 'openid email', nonce: 'n1', state: 's1', redirect_uri: 'https://abc.chromiumapp.org/' });
    expect(idTokenFromRedirect('https://abc.chromiumapp.org/#state=s1&id_token=tok', 's1')).toBe('tok');
    expect(idTokenFromRedirect('https://abc.chromiumapp.org/#state=other&id_token=tok', 's1')).toBeNull();
    expect(idTokenFromRedirect('https://abc.chromiumapp.org/', 's1')).toBeNull();
  });

  it('completes the launchWebAuthFlow round trip and stores the session', async () => {
    const idToken = token({ email: 'prof@uni.edu', exp: future });
    const identity = {
      getRedirectURL: () => 'https://abc.chromiumapp.org/',
      launchWebAuthFlow: async ({ url }: { url: string }) => {
        const state = new URL(url).searchParams.get('state');
        return `https://abc.chromiumapp.org/#state=${state}&id_token=${idToken}`;
      },
    };
    const session = await signInWithExtension('cid', identity);
    expect(session.email).toBe('prof@uni.edu');
    expect(readSession()?.idToken).toBe(idToken);
  });

  it('fails plainly when the user closes the Google window', async () => {
    const identity = { getRedirectURL: () => 'https://abc.chromiumapp.org/', launchWebAuthFlow: async () => undefined };
    await expect(signInWithExtension('cid', identity)).rejects.toThrow('did not return');
    expect(readSession()).toBeNull();
  });
});
