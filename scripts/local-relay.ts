/**
 * Runs the live-session relay on this machine, so a lesson can be taught and
 * followed without the AccessLensLiveSession stack:
 *
 *   npm run relay:local            # ws://localhost:8788
 *
 * then point the extension at it with VITE_ACCESSLENS_WS_URL=ws://localhost:8788.
 *
 * It is the same `Relay` the Lambda runs (`services/live-session/src/relay.ts`),
 * fed by a WebSocket server instead of API Gateway: the in-memory store the
 * relay's tests use, and no video stage (live video needs Amazon IVS, so a
 * session here says video is unavailable). Published packs are read from the
 * asset distribution exactly as the deployed relay reads them.
 *
 * Capabilities are signed with a secret made up per run, so the deployed AI
 * gateway (study chat, Ask, Whisper captions) will not accept sessions opened
 * here unless CAPABILITY_SECRET is set to the deployed relay's secret.
 *
 * Listens on 127.0.0.1 only and keeps everything in memory: stopping it ends
 * every session. For local testing, not for serving a class.
 */
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { Relay } from '../services/live-session/src/relay.js';
import { indexPack, type PackIndex } from '../services/live-session/src/rules.js';
import type { StagePort } from '../services/live-session/src/stage.js';
import { MemorySessionStore } from '../services/live-session/test/memoryStore.js';
import packJson from '../services/live-session/src/pack.json' with { type: 'json' };

const port = Number(process.argv[2] ?? process.env.PORT ?? 8788);
const packBase = (process.env.PACK_BASE_URL ?? 'https://d7dxgg82mglf.cloudfront.net').replace(/\/+$/u, '');

/** No IVS here: the relay logs the failure and opens the session without video. */
const noVideo: StagePort = {
  createStage: async () => { throw new Error('live video needs Amazon IVS; not available on the local relay'); },
  deleteStage: async () => {},
  createToken: async () => { throw new Error('no stage'); },
};

const sockets = new Map<string, WebSocket>();
const send = (socket: WebSocket | undefined, payload: unknown): boolean => {
  if (!socket || socket.readyState !== socket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
};

const relay = new Relay({
  store: new MemorySessionStore(),
  stage: noVideo,
  pack: indexPack(packJson as Parameters<typeof indexPack>[0]),
  resolvePack: async (packId: string, version: number): Promise<PackIndex | undefined> => {
    const response = await fetch(`${packBase}/packs/${encodeURIComponent(packId)}/${version}.json`);
    if (!response.ok) return undefined;
    return indexPack((await response.json()) as Parameters<typeof indexPack>[0]);
  },
  secret: process.env.CAPABILITY_SECRET ?? randomBytes(32).toString('hex'),
  post: async (connectionId, payload) => send(sockets.get(connectionId), payload),
});

const server = createServer((_request, response) => {
  response.writeHead(426, { 'content-type': 'text/plain' }).end('AccessLens local relay: connect with a WebSocket.\n');
});
const wss = new WebSocketServer({ noServer: true });

// The same `$connect` rule as handler.ts: a fresh client connects bare, and a
// reconnecting one presents its capability, which must resume or be refused.
server.on('upgrade', (request, socket, head) => {
  void (async () => {
    const connectionId = randomUUID();
    const params = new URL(request.url ?? '/', 'http://localhost').searchParams;
    const sessionId = params.get('sessionId');
    const presented = params.get('capability');
    if (sessionId && presented) {
      let capability: unknown;
      try {
        capability = JSON.parse(Buffer.from(presented, 'base64url').toString('utf8'));
      } catch {
        socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
        return;
      }
      const outcome = await relay.resume(connectionId, sessionId, capability, new Date());
      if (outcome.status !== 'ok') {
        socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
        return;
      }
    }
    wss.handleUpgrade(request, socket, head, ws => {
      sockets.set(connectionId, ws);
      ws.on('message', data => { void onMessage(connectionId, ws, String(data)); });
      ws.on('close', () => {
        sockets.delete(connectionId);
        void relay.disconnect(connectionId);
      });
    });
  })().catch(() => socket.destroy());
});

// The same `$default` routing as handler.ts.
async function onMessage(connectionId: string, ws: WebSocket, body: string): Promise<void> {
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(body);
  } catch {
    send(ws, { kind: 'error', reason: 'message-malformed' });
    return;
  }
  const capabilityOrError = (outcome: Awaited<ReturnType<Relay['create']>>) =>
    outcome.status === 'ok' ? { kind: 'capability', capability: outcome.capability } : { kind: 'error', reason: (outcome as { reason: string }).reason };
  switch (message.kind) {
    case 'create':
      send(ws, capabilityOrError(await relay.create(connectionId, String(message.sessionId))));
      return;
    case 'join':
      send(ws, capabilityOrError(await relay.join(connectionId, String(message.sessionId), message.role === 'instructor' ? 'instructor' : 'student')));
      return;
    case 'event': {
      const outcome = await relay.publish(connectionId, (message.event ?? {}) as Record<string, unknown>);
      if (outcome.status === 'ok') send(ws, { kind: 'accepted' });
      else if (outcome.status === 'rejected') send(ws, { kind: 'rejected', rules: outcome.rules });
      else send(ws, { kind: 'error', reason: outcome.reason });
      return;
    }
    case 'close': {
      const outcome = await relay.close(connectionId, String(message.sessionId));
      send(ws, outcome.status === 'ok' ? { kind: 'closed' } : { kind: 'error', reason: (outcome as { reason: string }).reason });
      return;
    }
    default:
      send(ws, { kind: 'error', reason: 'message-kind-not-allowlisted' });
  }
}

server.listen(port, '127.0.0.1', () => {
  console.log(`AccessLens local relay on ws://localhost:${port} (published packs from ${packBase}; no live video)`);
});
