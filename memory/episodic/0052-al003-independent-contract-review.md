# AL-003 independent contract review

## Goal

Complete the independent second review of the `capture.stopped` contract that
`docs/DEMO_PROOF_SPRINT.md` requires before the AL-003 lifecycle may be deployed
or described as live behavior, without deploying, without simulating a browser,
and without inventing human evidence.

## Changed files

- `docs/work/updates/AL-003-CHECKPOINT-20260916-0652.md` — the reviewer record:
  verdict per statement, reproduction commands, and three findings.
- `docs/DEMO_PROOF_SPRINT.md` — release record, per-statement verdicts on the
  AL-003 checklist, and the AL-004 bench coverage limit.
- `docs/CONTEXT_RELAY.md` — T-21 updated, T-31/T-32/T-33 opened, RL-035.
- `memory/INDEX.md` and this record.

No product or service code was changed. `rules.ts` is Part 4's and
`reference_event_check.py` is Part 5's, so the findings are threads, not edits.

## Validation evidence

`make check` reproduced green on `1524027` with counts identical to the recorded
`cd52f6e` run: 61 Access Pack, 24 relay, 5 delivery-board, 274 extension, and 53
live-session tests. The reference validator was run directly to probe field
acceptance. One disposable two-event session was created and closed against the
existing endpoint to re-verify the stale-endpoint finding independently.

## What the review found

Two of the four required statements are cleanly confirmed: stop (and browser
source termination) releases capture while retaining the session and the last
trusted student state, and a later `session.started` resumes the same session
monotonically while only `session.ended` closes delivery. Both have code paths
and tests behind them.

The interesting result is the third thing, which nobody had looked at from
outside the implementation: **`capture.stopped` is base-only only as deep as the
schemas.** `LiveEventSchema` and `live-event.schema.json` forbid `assetId` and
`regionId` on it; the relay and the Python reference do not. The sibling
base-only type `source.unmatched` *does* carry that server-side guard, because
charter A9 forced it. So one base-only lifecycle type is defended against a
non-conforming client and the other is not, and the asymmetry is invisible from
either schema.

It matters because of a second thing found while tracing the student path:
`liveRelayClient.subscribe` forwards an event only `if (parsed.success)`, with no
else branch and no log. Chain them and you get precisely the bug T-21 was opened
to kill — a `capture.stopped` that the relay accepts and stores as latest state,
that every conforming student silently discards, leaving the student view
reading "live" after the instructor stopped sharing. Neither half is reachable
from the shipped controller, whose `Emittable` type is base-only, so this is
hardening rather than a demo blocker; but the relay's own docstring says it
exists because "a client is whatever the person running it says it is."

Third finding, unrelated but sharper in its own way: `Relay.resume()` has no test
anywhere, and neither does the `$connect` route that reaches it — there is no
`handler.test.ts` at all. That is the path `WebSocketSessionClient` uses for
every reconnect, and the only path that can restore an instructor role onto a
fresh connection. AL-004's bench does not cover it either: its "rejoining
student" is a new anonymous `join`, which is the other branch of the same
decision. So the reconnect the demo actually performs is tested by nothing.

## Blocker

Deployment remains unattempted and unauthorized. This container has no AWS CLI
and no hackathon profile; the ambient `AWS_*` environment variables belong to the
sandbox, not the team's account, and were deliberately not inspected or used.
Real capture permission, two physical devices, recording, and consented reviewer
feedback all still require a human operator.

## Owner

Claude, at Anurup Kumar's direction (independent reviewer for AL-003; not the
implementing agent).

## Next action

Decide T-31 — either extend the `source.unmatched` guard to `capture.stopped` in
`rules.ts` and `reference_event_check.py` with a parity fixture, or accept it in
writing with the reason. Decide T-33 similarly. Then deploy under an authorized
profile and run `integration-test.mjs` and `quality-bench.mjs` against the new
URL. T-32 should be closed by a `resume` test before reconnect behavior is
claimed in the demo narration.
