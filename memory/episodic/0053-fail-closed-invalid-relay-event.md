# Fail closed on invalid relay events

## Goal

Eliminate the student-side false-live condition where the relay wrapper silently
dropped an inbound event that failed the shared `LiveEventSchema`, leaving the
student view marked live after an untrustworthy update.

## Changed files

- `apps/extension/src/shell/liveRelayClient.ts` and its tests — emit a
  payload-free optional invalid-event signal after dropping an invalid inbound
  event; raw payloads and parser detail never cross this hook.
- `apps/extension/src/student/StudentExperience.tsx`, `liveState.ts`, and tests
  — preserve the last reviewed state, show an explicit non-live message, and
  prevent a socket reconnect alone from turning a protocol failure back to live.
- `docs/DEMO_PROOF_SPRINT.md`, AL-003 checkpoint, and relay log — document the
  local-only proof and remaining deployment/rehearsal boundaries.

## Validation evidence

Focused TypeScript and UI tests passed (29 tests), followed by full `make check`:
61 Access Pack, 24 relay, 5 delivery-board, 277 extension, and 53 live-session
tests. The tracked unpacked-extension bundle was rebuilt with the source change.

## Blocker

The deployed endpoint still rejects `capture.stopped`, and this environment has
no authorized AWS profile. The actual WebSocket resume path and a real-device
malformed-event exercise remain unproven. A human review is required before
deploying capture/contract-adjacent behavior.

## Owner

Codex, at Anurup Kumar's direction (Part 1 extension safety hardening).

## Next action

Review `2d04fad`, then have the Part 4 owner resolve relay-side contract
enforcement and resume-path coverage before an authorized rebuild/deployment and
the AL-001/AL-004 physical-device evidence runs.
