import { createHash, timingSafeEqual } from 'node:crypto';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

interface AuthorizerEvent {
  readonly headers?: Record<string, string | undefined>;
  readonly identitySource?: string[];
}

interface AuthorizerResult {
  readonly isAuthorized: boolean;
  readonly context?: Record<string, string>;
}

const parameterName = process.env.TOKEN_PARAMETER_NAME ?? '';
const ssm = new SSMClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
let cachedToken: string | undefined;
let cachedAt = 0;
const CACHE_MS = 60_000;

/**
 * HTTP API Lambda authorizer. API Gateway also caches this simple response for
 * a short interval; the warm-Lambda cache avoids an SSM read on every request.
 * Hashing both values to a fixed-size digest keeps the final comparison
 * constant-time even when a caller supplies a token of a different length.
 */
export async function handler(event: AuthorizerEvent): Promise<AuthorizerResult> {
  const supplied = bearerToken(event);
  if (!supplied || !parameterName) return { isAuthorized: false };

  const expected = await loadToken();
  if (!expected) return { isAuthorized: false };

  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  const suppliedDigest = createHash('sha256').update(supplied, 'utf8').digest();
  const matches = timingSafeEqual(expectedDigest, suppliedDigest);
  return matches ? { isAuthorized: true } : { isAuthorized: false };
}

function bearerToken(event: AuthorizerEvent): string | undefined {
  const raw = Object.entries(event.headers ?? {})
    .find(([name]) => name.toLowerCase() === 'authorization')?.[1]
    ?? event.identitySource?.[0];
  if (!raw) return undefined;
  const match = raw.match(/^Bearer\s+([^\s]+)$/u);
  return match?.[1];
}

async function loadToken(): Promise<string | undefined> {
  const now = Date.now();
  if (cachedToken && now - cachedAt < CACHE_MS) return cachedToken;
  try {
    const result = await ssm.send(new GetParameterCommand({ Name: parameterName, WithDecryption: true }));
    const value = result.Parameter?.Value;
    if (!value) return undefined;
    cachedToken = value;
    cachedAt = now;
    return value;
  } catch {
    // Never disclose parameter lookup failures to callers or logs.
    return undefined;
  }
}
