---
id: AL-055
title: WebSocket reconnect catch-up, extended retry, and close() race fix
status: IN_REVIEW
priority: P1
depends_on: []
task_ids: [A2]
threads: [T-32]
affected_paths: [services/live-session/src/client,services/live-session/test]
contract_impact: none; client-side transport behavior only
data_impact: none
demo_impact: a reconnecting student actually catches up, a dropped connection keeps retrying for two minutes instead of giving up after ~9s, and a rapid Stop-then-End no longer risks losing the final session.ended
human_decision: none
---

## Outcome

Integrated the isolated part of `ui/blacksmith-revamp`'s `94f0047` (Omar
Rizwan): `services/live-session/src/client/webSocketSessionClient.ts` is
entirely independent of that branch's UI restyle and dyslexia-font content
(see AL-053/AL-054's handoffs), so this was cherry-picked as a scoped patch
covering just the client and its test, not the full commit.

Three real fixes:

- **Reconnect catch-up.** The relay's `resume` posts its catch-up event
  during `$connect`, before API Gateway can actually deliver it to the new
  connection -- it never arrives. On reconnect, a student client now joins
  again (the frozen protocol's existing way to ask for the latest view)
  instead of relying on the resume catch-up that was silently lost.
- **Extended retry.** Reconnect now keeps trying for two minutes (was
  effectively ~9s, exhausting a short fixed backoff list) and restarts
  immediately on the browser's `online` event rather than waiting for the
  next scheduled attempt.
- **`close()` race.** `close()` now waits briefly for in-flight events to be
  acknowledged before sending its own close message. Previously a `close`
  sent in the same instant as the last event (usually `session.ended`) could
  reach the relay first and get that event refused as landing on an
  already-closing connection -- the exact event students most need to see.

## Scope

`webSocketSessionClient.ts`: tracks in-flight event acknowledgment
(`accepted`/`rejected` relay responses), a `dropped` flag distinguishing a
fresh connect from a reconnect, `failingSince`/`retryForMs` for the extended
retry window, and an `online` event listener. `sessionClient.test.ts`: 5 new
tests covering the reconnect-join, extended retry, online-triggered retry,
and close-waits-for-ack behaviors (23 total, was 18).

## Non-goals

Did not merge the rest of `94f0047` (UI restyle-coupled CSS, the qa
bench/results docs specific to that branch's own deployed endpoint).

## Acceptance criteria

A reconnecting student's client sends a fresh `join` rather than relying on
`resume`'s catch-up. Reconnect attempts continue for up to two minutes and
restart on `online`. `close()` does not send its close frame until
in-flight events are acknowledged or a grace period elapses.

## Test plan

`services/live-session`'s own `npm test` (59 tests, up from 54); full `npm
test` at the repo root (360, extension suite unaffected since this file is
services-only); `npm run typecheck`; `make check`.

## Failure behavior

An expired capability does not retry (would only be refused); the grace
period on `close()` is bounded (`closeGraceMs`, default 2s) so a stuck
in-flight event can't hang shutdown indefinitely.

## Handoff requirements

None outstanding for the code itself. Real-device reconnect testing against
a deployed relay is part of the AWS deployment work already tracked as
blocked in this session (no AWS CLI/credentials here) and in T-32.
