import { describe, it, expect } from 'vitest';
import { createDefaultClient } from './createDefaultClient';
import { InMemorySessionClient } from '../shared/contracts';
import { BroadcastSessionClient } from '../shared/broadcastSessionClient';

// The WebSocket branch returns a validating wrapper (liveRelayClient.ts),
// not the WebSocketSessionClient instance itself -- so it's identified here
// by NOT being either fallback, rather than by its own constructor.
function isNeitherFallback(client: unknown): boolean {
  return !(client instanceof InMemorySessionClient) && !(client instanceof BroadcastSessionClient);
}

describe('createDefaultClient', () => {
  it('uses the real WebSocket relay when VITE_ACCESSLENS_WS_URL is set', () => {
    const client = createDefaultClient('wss://example.execute-api.us-east-1.amazonaws.com/demo');
    expect(isNeitherFallback(client)).toBe(true);
  });

  it('falls back to BroadcastChannel for same-browser demo when no URL is configured', () => {
    const client = createDefaultClient(undefined, true);
    expect(client).toBeInstanceOf(BroadcastSessionClient);
  });

  it('falls back to in-memory when neither a URL nor BroadcastChannel is available', () => {
    const client = createDefaultClient(undefined, false);
    expect(client).toBeInstanceOf(InMemorySessionClient);
  });

  it('prefers the live relay over BroadcastChannel when both are available', () => {
    const client = createDefaultClient('wss://example.execute-api.us-east-1.amazonaws.com/demo', true);
    expect(isNeitherFallback(client)).toBe(true);
  });
});
