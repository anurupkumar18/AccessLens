---
id: AL-011
title: Private catch up buffer
status: BLOCKED
priority: P1
depends_on: [AL-004]
task_ids: [A9,A10,A11,A13]
threads: []
affected_paths: [apps/extension/src/student,apps/extension/src/shared]
contract_impact: none
data_impact: local-only
demo_impact: Lets a student revisit the current and prior three approved moments privately.
human_decision: retention boundary confirmation
---

## Outcome

Provide current-return, prior-three, repeat-description, and local bookmark behavior that clears at session end.

## Scope

Store only reviewed semantic events and local pack references on the student device.

## Non-goals

Do not upload history, infer behavior, or keep it after a session without a decision.

## Acceptance criteria

The buffer never writes to transport and clears on end; student controls remain local.

## Test plan

Use fixture replay, local-storage tests, and network-payload assertions.

## Failure behavior

Retain current trusted render state and explain unavailable history without inventing events.

## Handoff requirements

Link the retention decision and local-data tests.
