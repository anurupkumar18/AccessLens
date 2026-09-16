# Wire the deployed live relay into the shell, and launch-test the whole stack

## Goal

At the user's request, merge Part 4 (just pushed as `workstream/4-aws-live`,
already deployed to a real AWS account) and then actually launch and test the
integrated system across Parts 1, 2, 3, 4, and 5 together.

## Changed files

- `apps/extension/src/shell/createDefaultClient.ts` (new) -- three-tier
  transport selection: Part 4's real relay when `VITE_ACCESSLENS_WS_URL` is
  set, `BroadcastChannel` for a same-browser demo otherwise, in-memory as the
  last resort. This closes T-25 ("the two meeting"), which Part 4's own
  status row named as the top remaining risk: the relay was deployed and
  verified, but nothing in the extension pointed at it yet.
- `apps/extension/src/shell/liveRelayClient.ts` (new) -- Part 4's
  `WebSocketSessionClient` deliberately types events and capabilities as
  `Record<string, unknown>` so it never imports Part 1's schema package
  ("Validation is the relay's job and Part 1's schema is the client's," per
  its own docstring). This wrapper is where that job actually happens:
  every inbound event is validated against `LiveEventSchema` before
  reaching a subscriber (dropped, not forwarded, if invalid), and every
  capability from `create`/`join` is validated against
  `RoleCapabilitySchema` (rejecting the promise if malformed). Also fixes a
  real `tsc` error: assigning `WebSocketSessionClient` directly to the
  extension's `SessionClient` type failed structurally because `subscribe`'s
  listener parameter was typed as a bare `Record<string, unknown>` instead
  of the discriminated `LiveEvent` union.
- `apps/extension/src/shell/App.tsx` -- `defaultClient` now goes through
  `createDefaultClient(import.meta.env.VITE_ACCESSLENS_WS_URL)`.
- `apps/extension/src/vite-env.d.ts` -- typed `ImportMetaEnv` for the two
  names `.env.example` already froze.
- Both new modules have their own test suites (4 + 7 tests).
- `dist/` rebuilt -- deliberately *without* `VITE_ACCESSLENS_WS_URL` set, so
  the committed default artifact stays network-free (BroadcastChannel/
  in-memory), matching every other build this session. A build with the live
  URL was made and manually tested but not committed -- see below.

## Validation evidence

- `npx tsc --noEmit`: clean.
- `npx vitest run`: 250/250 (up from 239; +11 for the two new modules).
- `make check`: memory (49 docs), pack (61), relay (24), extension (250),
  and `live-session` (49, after `npm install` inside `services/live-session/`
  -- it has its own `package.json` the root install doesn't touch) all green.
- **Ran Part 4's own `services/live-session/scripts/integration-test.mjs`
  against the real, live endpoint**
  (`wss://ktlrnmxq0f.execute-api.us-east-1.amazonaws.com/demo`): 12/12 --
  instructor + two student capabilities issued, 19 events relayed to both
  students in order with the instructor never echoed, and all five refusal
  checks (student publishing, replayed sequence, raw-frame payload, and
  post-close events) held.
- **Built the extension with the live URL baked in and tested it in two real
  browser tabs against the actual deployed relay** (not a local mock):
  - Instructor tab, clicking Start: got "Sharing is required for live sync"
    rather than "Could not open a session," which the source
    (`captureController.ts`) only produces when `client.create()` already
    *succeeded* and it was the subsequent `getDisplayMedia()` call that
    failed. This sandbox cannot grant real screen-share permission, so this
    is as far as the capture path can be verified here -- but it is genuine
    confirmation that `create()` round-tripped to the live relay from the
    real UI.
  - Student tab, joining a made-up code (`ZZZZZZ`) with no capture
    permission needed at all: got "Could not join this session. Check the
    code and try again" -- a real rejection from the live relay (session
    doesn't exist), not a canned offline message.
  - No console errors on either tab.

## Blocker

None for the wiring itself. What remains genuinely blocked on a human: an
actual `chrome://extensions` unpacked load, granting real `getDisplayMedia()`
permission, and watching a slide sync from one real device to another over
the live relay. Nothing in this environment can grant that permission or
drive two separate physical devices.

## Owner

Anurup Kumar (Part 1; wiring performed cross-cutting since it touches the
shell and Part 4's client together).

## Next action

A human should do the real two-device test this environment cannot: load
`dist/` unpacked (built with `VITE_ACCESSLENS_WS_URL` set in `.env.local`),
share a real window as instructor, and join from a second device or browser
profile as student, confirming the slide-recognition-to-AR-sync path over
the live relay end to end. `docs/ACCESSLENS_MVP_REVISION.md` is still
uncommitted and undecided -- untouched by this session.
