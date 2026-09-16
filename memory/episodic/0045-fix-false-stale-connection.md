# Fix false "Connection interrupted" alarms in the Student view

## Goal

The user's teammates were live-testing the real extension against the real
deployed relay and hit "Connection interrupted. Showing the last reviewed
state." with a "Stale" badge while the connection was actually fine.
Diagnose and fix.

## Root cause

`StudentExperience.tsx` marked the view "stale" after **15 seconds with no
new live event** -- a content-silence timer standing in for a connection
check. Any instructor explaining one region for more than 15 seconds
(completely normal lecture pacing) falsely triggered "Connection
interrupted," regardless of whether the socket was open. This predates the
live-relay wiring: the same false alarm would have fired against
`BroadcastChannel` too, just less consequentially since that transport
never actually drops mid-demo the way a live device's Wi-Fi can.

## Fix

`WebSocketSessionClient` (`services/live-session/src/client/
webSocketSessionClient.ts`) already tracked real socket open/close
internally but exposed none of it. Added `onConnectionChange(listener):
() => void` -- additive to the frozen `SessionClient` interface, not a
change to it, so `create`/`join`/`send`/`subscribe`/`close` and every
existing caller are untouched. Fires `true` on socket open, `false` on
close (including the terminal close after backoff is exhausted).

`apps/extension/src/shell/liveRelayClient.ts`'s `wrapLiveRelayClient` passes
this through when the underlying client has it (new `LiveRelaySessionClient`
type, `SessionClient` plus the same optional hook).

`apps/extension/src/student/StudentExperience.tsx` now subscribes to
`onConnectionChange` when the client exposes it, and drives `live`/`stale`
from that instead of a timer. `BroadcastChannel`/`InMemorySessionClient`
have no such method, so a student on the local demo transport never goes
falsely stale from a quiet instructor -- there was never a real disconnect
concept for those transports to report in the first place.

`apps/extension/src/student/liveState.ts` gained `markLiveStateReconnected`
(stale -> live, "Reconnected.") as the counterpart to the existing
`markLiveStateStale`; the stale message itself did not need to change, since
it is now accurate (a real disconnect) rather than a guess.

## Changed files

- `services/live-session/src/client/webSocketSessionClient.ts` --
  `onConnectionChange`, +3 tests (18 total, was 15).
- `apps/extension/src/shell/liveRelayClient.ts` -- pass-through, +2 tests
  (9 total, was 7).
- `apps/extension/src/student/liveState.ts` -- `markLiveStateReconnected`,
  +2 tests (7 total, was 5).
- `apps/extension/src/student/StudentExperience.tsx` -- removed the 15s
  timer effect, added the real `onConnectionChange` subscription, +2 tests
  (6 total, was 4).

## Validation evidence

- `npx tsc --noEmit`: clean.
- `npx vitest run`: 259/259 (was 250; +9 across the four files above).
- `services/live-session`: `npm run check` -- 52/52, typecheck and bundle
  both clean.
- `make check`: memory, pack, relay, extension, and live-session all green.
- Manually reloaded the rebuilt `dist/` in the sandboxed browser: no console
  errors, Student view renders "waiting" correctly with no client connected
  (`BroadcastChannel`/in-memory transports have no `onConnectionChange`, so
  they're unaffected by this change, as intended).

## Blocker

None. The actual live scenario that surfaced this (two real devices, real
Wi-Fi, a real instructor pausing on a slide) still needs a human with real
Chrome to re-verify end to end -- this sandbox proved the unit-level fix but
cannot reproduce a real device's flaky Wi-Fi to watch the badge recover.

## Owner

Anurup Kumar (cross-cutting: touches Part 1's `liveRelayClient.ts`, Part 3's
`StudentExperience.tsx`/`liveState.ts`, and Part 4's
`webSocketSessionClient.ts`; fixed directly since the bug was actively
blocking a live team test and Part 3 has no owner to hand it to).

## Next action

Your teammates should retry the same live session now with the rebuilt
extension (`npm run build` with `VITE_ACCESSLENS_WS_URL` set) and confirm
the "Stale" badge no longer appears just from a quiet instructor, and does
appear (then recovers) on a genuine disconnect -- e.g. toggling Wi-Fi on the
student's device.
