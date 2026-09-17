/**
 * Instructor sign-in with a Google account (D12). The API only accepts a
 * Google ID token, verified by API Gateway and checked against the
 * deployment's instructor allowlist; nothing here is trusted by itself.
 *
 * Two ways to obtain the token, chosen at runtime:
 * - inside the extension, `chrome.identity.launchWebAuthFlow` runs Google's
 *   OAuth page and hands back the ID token from the redirect fragment (the
 *   extension's CSP forbids loading Google's script);
 * - on a plain web page (local hosting), Google Identity Services renders
 *   its button and calls back with the credential.
 *
 * The token lives in this browser's localStorage until it expires (about an
 * hour). It identifies an instructor, never a student (charter A4).
 */
export interface GoogleSession {
  readonly idToken: string;
  readonly email: string;
  /** Unix milliseconds. */
  readonly expiresAt: number;
}

/** The OAuth web client id this build signs in with, or null when sign-in is not offered. */
export const googleClientId: string | null = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || null;

const SESSION_KEY = 'accesslens.authoring.session';

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/gu, '+').replace(/_/gu, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return decodeURIComponent(Array.from(atob(padded), c => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
}

/** Reads the token's email and expiry. No verification: the API does that. */
export function sessionFromIdToken(idToken: string): GoogleSession | null {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as { email?: unknown; exp?: unknown };
    if (typeof payload.email !== 'string' || typeof payload.exp !== 'number') return null;
    return { idToken, email: payload.email, expiresAt: payload.exp * 1000 };
  } catch {
    return null;
  }
}

export function readSession(now: number = Date.now(), storageKey = SESSION_KEY): GoogleSession | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const session = raw ? sessionFromIdToken(raw) : null;
    if (session && session.expiresAt > now) return session;
    if (raw) window.localStorage.removeItem(storageKey);
    return null;
  } catch {
    return null;
  }
}

export function writeSession(session: GoogleSession | null, storageKey = SESSION_KEY): void {
  try {
    if (session) window.localStorage.setItem(storageKey, session.idToken);
    else window.localStorage.removeItem(storageKey);
  } catch {
    /* remembered for this page only */
  }
}

/** Google's OAuth 2.0 endpoint asked for an ID token only (implicit flow, no access token). */
export function authorizationUrl(options: { clientId: string; redirectUri: string; nonce: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'id_token',
    scope: 'openid email',
    nonce: options.nonce,
    state: options.state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** The ID token in an OAuth redirect URL's fragment, when the state matches. */
export function idTokenFromRedirect(redirectUrl: string, expectedState: string): string | null {
  const hash = redirectUrl.split('#')[1];
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  if (params.get('state') !== expectedState) return null;
  return params.get('id_token');
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

interface ChromeIdentity {
  getRedirectURL(): string;
  launchWebAuthFlow(details: { url: string; interactive: boolean }): Promise<string | undefined>;
}

/** Present when running as the installed extension. */
export function extensionIdentity(): ChromeIdentity | null {
  const api = (globalThis as { chrome?: { identity?: Partial<ChromeIdentity> } }).chrome?.identity;
  return api?.launchWebAuthFlow && api.getRedirectURL ? (api as ChromeIdentity) : null;
}

/** Sign in through the browser's extension identity API. */
export async function signInWithExtension(clientId: string, identity: ChromeIdentity = extensionIdentity()!, storageKey = SESSION_KEY): Promise<GoogleSession> {
  const nonce = randomToken();
  const state = randomToken();
  const redirect = await identity.launchWebAuthFlow({
    url: authorizationUrl({ clientId, redirectUri: identity.getRedirectURL(), nonce, state }),
    interactive: true,
  });
  const idToken = redirect ? idTokenFromRedirect(redirect, state) : null;
  const session = idToken ? sessionFromIdToken(idToken) : null;
  if (!session) throw new Error('Google did not return a sign-in for this account.');
  writeSession(session, storageKey);
  return session;
}

interface GoogleAccounts {
  accounts: {
    id: {
      initialize(config: { client_id: string; callback: (response: { credential: string }) => void; ux_mode?: 'popup' }): void;
      renderButton(parent: HTMLElement, options: { type?: 'standard'; theme?: 'outline'; size?: 'large'; text?: 'signin_with' }): void;
    };
  };
}

let gisLoading: Promise<GoogleAccounts> | null = null;
/** Loads Google Identity Services once (web page only; the extension never loads remote script). */
function loadGoogleIdentity(): Promise<GoogleAccounts> {
  const existing = (globalThis as { google?: GoogleAccounts }).google;
  if (existing?.accounts?.id) return Promise.resolve(existing);
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => {
        const loaded = (globalThis as { google?: GoogleAccounts }).google;
        if (loaded?.accounts?.id) resolve(loaded); else reject(new Error('Google sign-in did not load.'));
      };
      script.onerror = () => reject(new Error('Google sign-in could not be loaded.'));
      document.head.appendChild(script);
    });
  }
  return gisLoading;
}

/** Renders Google's own sign-in button into `parent`; `onSession` fires with the stored session. */
export async function renderGoogleButton(parent: HTMLElement, clientId: string, onSession: (session: GoogleSession) => void, storageKey = SESSION_KEY): Promise<void> {
  const google = await loadGoogleIdentity();
  google.accounts.id.initialize({
    client_id: clientId,
    ux_mode: 'popup',
    callback: response => {
      const session = sessionFromIdToken(response.credential);
      if (session) { writeSession(session, storageKey); onSession(session); }
    },
  });
  google.accounts.id.renderButton(parent, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with' });
}

/** Google's OAuth 2.0 endpoint asked for an access token with the given scopes (implicit flow). */
export function accessTokenAuthorizationUrl(options: { clientId: string; redirectUri: string; scope: string; state: string; loginHint?: string }): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'token',
    scope: options.scope,
    state: options.state,
    include_granted_scopes: 'true',
    ...(options.loginHint ? { login_hint: options.loginHint } : { prompt: 'select_account' }),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** The access token and its lifetime from an OAuth redirect URL's fragment, when the state matches. */
export function accessTokenFromRedirect(redirectUrl: string, expectedState: string): { accessToken: string; expiresInSeconds: number } | null {
  const hash = redirectUrl.split('#')[1];
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token');
  if (params.get('state') !== expectedState || !accessToken) return null;
  return { accessToken, expiresInSeconds: Number(params.get('expires_in') ?? '0') || 0 };
}

/**
 * An access token for a Google API scope, obtained through the extension's
 * identity flow and reused until shortly before it expires. Used only for
 * reading the instructor's own Slides deck order; never sent to our API.
 */
export function createExtensionAccessTokens(clientId: string, identity: ChromeIdentity = extensionIdentity()!, now: () => number = Date.now): (scope: string) => Promise<string> {
  const held = new Map<string, { accessToken: string; expiresAt: number }>();
  return async (scope) => {
    const current = held.get(scope);
    if (current && current.expiresAt - 60_000 > now()) return current.accessToken;
    const state = randomToken();
    const redirect = await identity.launchWebAuthFlow({
      url: accessTokenAuthorizationUrl({ clientId, redirectUri: identity.getRedirectURL(), scope, state, loginHint: readSession(now())?.email }),
      interactive: true,
    });
    const granted = redirect ? accessTokenFromRedirect(redirect, state) : null;
    if (!granted) throw new Error('Google did not grant access to read your Slides deck.');
    held.set(scope, { accessToken: granted.accessToken, expiresAt: now() + granted.expiresInSeconds * 1000 });
    return granted.accessToken;
  };
}
