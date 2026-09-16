---
id: AL-050
title: Server-side caption shape validation
status: IN_REVIEW
priority: P1
depends_on: [AL-048]
task_ids: [A2]
threads: [T-16]
affected_paths: [services/live-session/src,packages/access-packs/bio-cell-demo/tools,packages/access-packs/bio-cell-demo/fixtures/invalid,packages/access-packs/bio-cell-demo/README.md]
contract_impact: none; additive server-side rule, no shared schema change
data_impact: temporary-service
demo_impact: closes a gap found in security review of AL-048/AL-049 before any real deployment used it
human_decision: none
---

## Outcome

A security review of AL-048 (the `caption.appended` payload) found that
`services/live-session/src/rules.ts` -- the relay's own docstring calls it
"the only place that can refuse [a hostile or broken client] for everyone" --
validated `pointer` and `arState` shape/bounds but not `caption`. `caption`
was only checked for being a *known field name*, never for being the
`{text: string ≤280 chars, isFinal: boolean}` shape the client-side Zod/JSON
Schema contract requires. A client that talks to the relay's WebSocket
protocol directly, bypassing the vetted extension build, could send an
oversized or malformed `caption` and have it broadcast unbounded to every
student in the session -- defeating the bounded-caption privacy property the
feature is supposed to guarantee.

## Scope

- `reference_event_check.py` (source of truth for rule names): added
  `caption-not-an-object`, `caption-text-missing`, `caption-text-too-long`,
  `caption-isfinal-not-boolean`.
- `services/live-session/src/rules.ts`: mirrored the same four rules in the
  same check order, so the parity test's ordered comparison holds.
- New negative fixture `fixtures/invalid/oversized-caption.json` (281-char
  caption), picked up automatically by the pack's negative-fixture test suite
  and the relay/TS parity tests.
- `services/live-session/test/relay.test.ts`: an integration test proving
  the actual relay rejects it end-to-end, not just the rule function in
  isolation.
- Updated the stale "ten single-fault fixtures" count in
  `packages/access-packs/bio-cell-demo/README.md`.

## Non-goals

No change to the client-side Zod/JSON Schema contract (already correct) and
no per-event-type restriction on which types may carry `caption` -- that
type-level restriction is the client contract's job, consistent with how
`pointer` and `arState` are already handled at this layer (shape/bounds only,
not type-membership).

## Acceptance criteria

`checkEvent`/`check_event` reject a `caption.appended` event whose `caption`
is not an object, whose `text` is missing/empty/over 280 characters, or whose
`isFinal` is not a boolean -- proven against a real fixture through both the
Python reference, the TypeScript mirror, and an end-to-end relay test, not
just asserted in prose.

## Test plan

`python3 -m unittest discover -s tests/access_pack` (62 tests, including the
new fixture via the existing auto-discovering negative-fixture suite),
`npm test -- --run services/live-session` (54 tests, including the new
relay-level rejection test and the updated parity-count assertion), full
`npm test` (339), `npm run typecheck`, `make check`.

## Failure behavior

An oversized or malformed caption is rejected at the relay with a named rule
in the rejection response; nothing is broadcast to any connected student.

## Handoff requirements

None outstanding. This closes the gap found in review before any real
deployment (the live endpoint referenced elsewhere in this repo is already
known-stale and unrelated to this fix) ever carried a caption.
