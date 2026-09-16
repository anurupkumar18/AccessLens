---
id: AL-091
title: Session context handoff template
status: BLOCKED
priority: P2
depends_on: [AL-090]
task_ids: []
threads: [T-17,T-18,T-24]
affected_paths: [docs/work]
contract_impact: delivery handoff metadata only
data_impact: none
demo_impact: Keeps demo evidence and known limits available across agent handoffs.
human_decision: none
---

## Outcome

Provide an example handoff update that records goal, branch, evidence, risk, next action, and data boundary.

## Scope

Make it usable without editing a shared relay table for ordinary ticket progress.

## Non-goals

Do not duplicate cross-cutting product decisions.

## Acceptance criteria

An incoming agent can create a valid HANDOFF update from the documented template.

## Test plan

Validate the example through the work-board checker.

## Failure behavior

Require a new update when any required handoff field is absent.

## Handoff requirements

Link the template from the delivery README.
