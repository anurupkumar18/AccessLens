import type { SessionClient } from '../shared/contracts';
import { InMemorySessionClient } from '../shared/contracts';
import { BroadcastSessionClient, hasBroadcastChannel } from '../shared/broadcastSessionClient';
import { WebSocketSessionClient } from '../../../../services/live-session/src/client/webSocketSessionClient';
import { wrapLiveRelayClient } from './liveRelayClient';

/**
 * Three transports, in priority order:
 *  1. Part 4's real relay, when `VITE_ACCESSLENS_WS_URL` names one -- works
 *     across real devices and networks.
 *  2. `BroadcastChannel`, when available -- instructor and student tabs in
 *     the same browser profile follow each other with no network.
 *  3. In-memory -- same JS realm only (tests, and browsers without
 *     `BroadcastChannel`).
 * `wsUrl` and `broadcastAvailable` are parameters rather than read directly
 * so this is testable without stubbing `import.meta.env` or a real browser.
 */
export function createDefaultClient(
  wsUrl: string | undefined,
  broadcastAvailable: boolean = hasBroadcastChannel(),
): SessionClient {
  // A factory, so a session ended on this page does not leave the page unable to open another.
  if (wsUrl) return wrapLiveRelayClient(() => new WebSocketSessionClient({ url: wsUrl }));
  return broadcastAvailable ? new BroadcastSessionClient() : new InMemorySessionClient();
}
