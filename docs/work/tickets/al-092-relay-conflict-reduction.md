---
id: AL-092
title: Relay conflict reduction
status: BLOCKED
priority: P2
depends_on: [AL-090]
task_ids: []
threads: [T-17,T-18,T-24]
affected_paths: [docs/CONTEXT_RELAY.md,docs/work,scripts]
contract_impact: coordination-file boundary only
data_impact: none
demo_impact: Reduces integration friction that can hide demo regressions.
human_decision: approve any migration of the existing relay log
---

## Outcome

Propose and validate a conflict-resistant boundary between ticket updates and the cross-cutting relay.

## Scope

Use the new immutable update model for ordinary work; preserve current relay history.

## Non-goals

Do not rewrite or delete relay history without a reviewed migration.

## Acceptance criteria

The proposal proves ordinary claims/checkpoints need no shared-table edit.

## Test plan

Add a structural check or migration fixture before changing the existing relay.

## Failure behavior

Keep the current relay and record the unresolved conflict risk.

## Handoff requirements

Link a human-approved migration decision if the relay format changes.
