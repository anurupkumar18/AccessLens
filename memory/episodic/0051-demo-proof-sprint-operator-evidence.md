# Demo-proof sprint operator evidence

## Goal

Turn the remaining A14–A16 demo-evidence gaps into repeatable, privacy-safe
operator runs without representing unattended tooling as real browser capture,
two-device validation, deployment, recording, or human feedback.

## Changed files

- `docs/DEMO_PROOF_SPRINT.md` and `docs/DEMO_RUNBOOK.md` — release, deployment,
  capture-matrix, bench, rehearsal/fallback, and formative-review evidence
  templates with explicit claim limits.
- `services/live-session/scripts/quality-bench.mjs` and its package script — a
  disposable 30-event, two-client relay bench reporting same-process latency,
  skew, ordering, and `capture.stopped` latest-state recovery.
- `docs/work/updates/AL-003-BLOCKER-20260916-0031.md` and
  `docs/CONTEXT_RELAY.md` — exact lifecycle deployment blocker and handoff.

## Validation evidence

`make check` passed on release `cd52f6e`: 61 Access Pack, 24 relay, 5
delivery-board, 274 extension, and 53 live-session tests. The existing endpoint
passed the 19-event integration test and delivered 30/30 ordered region events to
each bench client (139.3/186.2 ms same-process p50/p95 latency; 2.4/11.7 ms
skew), but rejected `capture.stopped` as `event-type-not-allowlisted`.

## Blocker

The machine has no AWS CLI installation, AWS profile directory, or credentials,
so the reviewed `capture.stopped` service cannot be deployed here. An independent
contract review is also still required. Real capture permissions, two physical
devices, recording, and consented feedback require a human operator.

## Owner

Codex, at Anurup Kumar's direction (cross-cutting demo evidence and Part 4
diagnostic tooling).

## Next action

Use the operator packet after an authorized AL-003 review/deployment. Run the
relay integration test and quality bench, complete AL-001's real-device matrix,
then record two rehearsals, a truthful fallback, and only consented formative
feedback.
