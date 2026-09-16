---
id: AL-003
title: Clarify stop versus end session lifecycle
status: IN_REVIEW
priority: P0
depends_on: []
task_ids: [A2,A3,A5,A8,A14]
threads: [T-21]
affected_paths: [apps/extension/src/instructor,apps/extension/src/student,apps/extension/src/shared,services/live-session]
contract_impact: likely additive lifecycle event or documented terminal semantics
data_impact: temporary-service
demo_impact: Students receive accurate stopped-versus-ended wording.
human_decision: none
---

## Outcome

Make stopping capture distinct from permanently ending a temporary session.

## Scope

Trace the event contract, instructor control, relay behavior, and student state together.

## Non-goals

Do not redesign identity, introduce persistence, or change live-event privacy fields.

## Acceptance criteria

The observable states are documented, contract-tested, and rendered accurately after stop and end.

## Test plan

Add focused lifecycle tests on both client and relay boundaries.

## Failure behavior

Preserve the last trusted student state; do not imply a session is live when capture stopped.

## Handoff requirements

Publish a CONTRACT_DELTA before code and reference T-21 when merged.
