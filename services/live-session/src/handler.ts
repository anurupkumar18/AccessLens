/**
 * API Gateway WebSocket adapter. Thin by design.
 *
 * Everything this file does is translate: API Gateway event in, `Relay` call,
 * response out. The moment a decision starts being made here instead of in
 * `relay.ts`, it becomes a decision that can only be tested by deploying.
 *
 * Routes: `$connect`, `$disconnect`, and `$default` for every message. The
 * message shapes are Part 1's frozen `SessionMessageSchema` -- create, join,
 * close, and event -- which is `.strict()`, so a capability cannot be smuggled
 * in as an extra field on a message. That is why a resuming client presents its
 * capability in the `$connect` query string instead.
 */
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { Relay } from './relay.js';
import { SessionStore } from './store.js';
import { indexPack, type PackIndex } from './rules.js';
import { log } from './log.js';
import packJson from './pack.json' with { type: 'json' };

interface RequestContext {
  connectionId: string;
  routeKey: string;
  domainName?: string;
  stage?: string;
}

interface WebSocketEvent {
  requestContext: RequestContext;
  body?: string | null;
  queryStringParameters?: Record<string, string | undefined> | null;
}

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
};

type Post = (connectionId: string, payload: unknown) => Promise<boolean>;

let cached: { relay: Relay; pack: PackIndex; post: Post } | undefined;

function build(endpoint: string): { relay: Relay; post: Post } {
  const store = new SessionStore({
    sessionsTable: required('SESSIONS_TABLE'),
    connectionsTable: required('CONNECTIONS_TABLE'),
    connectionsBySessionIndex: required('CONNECTIONS_BY_SESSION_INDEX'),
  });
  const management = new ApiGatewayManagementApiClient({ endpoint });
  const pack = indexPack(packJson as Parameters<typeof indexPack>[0]);

  const post: Post = async (connectionId, payload) => {
    try {
      await management.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: Buffer.from(JSON.stringify(payload)),
        }),
      );
      return true;
    } catch (error) {
      // 410 Gone is the normal way a browser tab closing shows up here. It is
      // not an error worth logging as one.
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status !== 410) log.warn('post-failed', { status: status ?? 0 });
      return false;
    }
  };

  // Packs the authoring pipeline published live at packs/<id>/<version>.json
  // under the asset distribution; the relay reads them the way students do.
  const packBase = process.env.PACK_BASE_URL?.replace(/\/+$/u, '');
  const resolvePack = packBase
    ? async (packId: string, version: number): Promise<PackIndex | undefined> => {
        const response = await fetch(`${packBase}/packs/${encodeURIComponent(packId)}/${version}.json`);
        if (!response.ok) return undefined;
        return indexPack((await response.json()) as Parameters<typeof indexPack>[0]);
      }
    : undefined;

  cached = {
    relay: new Relay({ store, pack, resolvePack, secret: required('CAPABILITY_SECRET'), post }),
    pack,
    post,
  };
  return cached;
}

const ok = (body: unknown = { ok: true }) => ({
  statusCode: 200,
  body: JSON.stringify(body),
});

export const handler = async (event: WebSocketEvent) => {
  const { connectionId, routeKey, domainName, stage } = event.requestContext;
  const endpoint = `https://${domainName}/${stage}`;
  const { relay, post } = cached ?? build(endpoint);

  /**
   * Send a reply to the client that just spoke.
   *
   * A WebSocket API does *not* forward a Lambda's return body to the client --
   * that needs an explicitly configured route response, which is a second
   * delivery mechanism to keep in sync with this one. Since the relay already
   * holds a management-API connection for broadcasting, replies go back the
   * same way: one channel, one set of failure modes, and `$connect` (where
   * posting is impossible, as the connection is not established yet) stays the
   * only place that answers with a status code alone.
   */
  const reply = async (payload: unknown) => {
    await post(connectionId, payload);
    return ok();
  };

  if (routeKey === '$disconnect') {
    await relay.disconnect(connectionId);
    return ok();
  }

  if (routeKey === '$connect') {
    // A fresh client connects with no parameters and then sends create/join.
    // A reconnecting one presents the capability it already holds, which is the
    // only way the relay can know what role a brand-new connection has.
    const params = event.queryStringParameters ?? {};
    if (!params.sessionId || !params.capability) return ok();
    let capability: unknown;
    try {
      capability = JSON.parse(Buffer.from(params.capability, 'base64url').toString('utf8'));
    } catch {
      return { statusCode: 401, body: 'capability-malformed' };
    }
    const outcome = await relay.resume(connectionId, params.sessionId, capability, new Date());
    // Refuse the connection outright rather than accepting it role-less: a
    // client that thinks it resumed but silently did not is worse than one that
    // sees its connection fail.
    if (outcome.status !== 'ok') return { statusCode: 401, body: outcome.status };
    return ok();
  }

  let message: Record<string, unknown>;
  try {
    message = JSON.parse(event.body ?? '{}');
  } catch {
    return reply({ kind: 'error', reason: 'message-malformed' });
  }

  switch (message.kind) {
    case 'create': {
      const outcome = await relay.create(connectionId, String(message.sessionId));
      return reply(
        outcome.status === 'ok'
          ? { kind: 'capability', capability: outcome.capability }
          : { kind: 'error', reason: (outcome as { reason: string }).reason },
      );
    }
    case 'join': {
      const outcome = await relay.join(
        connectionId,
        String(message.sessionId),
        message.role === 'instructor' ? 'instructor' : 'student',
      );
      return reply(
        outcome.status === 'ok'
          ? { kind: 'capability', capability: outcome.capability }
          : { kind: 'error', reason: (outcome as { reason: string }).reason },
      );
    }
    case 'event': {
      const outcome = await relay.publish(
        connectionId,
        (message.event ?? {}) as Record<string, unknown>,
      );
      if (outcome.status === 'ok') return reply({ kind: 'accepted' });
      if (outcome.status === 'rejected') return reply({ kind: 'rejected', rules: outcome.rules });
      return reply({ kind: 'error', reason: outcome.reason });
    }
    case 'close': {
      const outcome = await relay.close(connectionId, String(message.sessionId));
      return reply(
        outcome.status === 'ok'
          ? { kind: 'closed' }
          : { kind: 'error', reason: (outcome as { reason: string }).reason },
      );
    }
    default:
      return reply({ kind: 'error', reason: 'message-kind-not-allowlisted' });
  }
};
