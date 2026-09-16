# Stop versus end-session lifecycle

## Goal

Resolve T-21 and AL-003: a Stop action must not tell students that a temporary
session ended when the instructor can explicitly Start capture again using the
same join code.

## Implemented behavior

- Added base-only, instructor-only `capture.stopped` to the extension Zod
  contract, checked-in JSON Schema, pack reference validator, simulator, and
  relay validator parity.
- `stop()` and browser source termination release the local stream and emit
  `capture.stopped`; the relay remains open and stores that lifecycle state as
  its one temporary latest state for late joiners.
- Student state displays `stopped` and preserves the last trusted reviewed
  region; `session.started` can resume the same session and monotonic stream.
- `endSession()` emits terminal `session.ended` after any needed
  `capture.stopped`, then closes the client. The relay still closes immediately
  on `session.ended`.

## Changed files

- Shared Zod/JSON contracts and their tests; the Python reference validator and
  generated lifecycle fixture.
- Instructor controller/panel tests, student lifecycle/render tests, and relay
  validation/latest-state tests.
- `docs/SYSTEM_DESIGN.md`, `docs/CONTEXT_RELAY.md`, and AL-003 delivery records.

## Validation evidence

`make check` passed: 61 Access Pack, 24 relay, 5 delivery-board, 266 extension,
and 53 live-session tests. Focused relay tests prove a stopped session remains
joinable and a late student receives `capture.stopped` rather than a false live
state.

## Remaining boundary

This is locally verified source behavior, not yet deployed-AWS evidence. The
shared contract requires a second review before merge; deploy only after that
review and an authorized service build/deploy step.

## Blocker

No implementation blocker. Completion is held for the required second
shared-contract review and then an authorized deployed-relay update.

## Owner

Codex, at Anurup Kumar's direction (cross-cutting Part 1, Part 2, Part 3, and
Part 4 paths).

## Next action

Review AL-003, then build `services/live-session` and deploy the reviewed relay
before exercising the real-device capture matrix (AL-001) against the updated
endpoint.
