---
id: AL-090
title: Repository work board tooling
status: IN_REVIEW
priority: P0
depends_on: []
task_ids: []
threads: [T-17,T-18,T-24,T-29]
affected_paths: [docs/work,docs/product,scripts,tests,Makefile]
contract_impact: delivery metadata contract only
data_impact: none
demo_impact: Makes every later demo claim traceable to a ticket and evidence.
human_decision: none
---

## Outcome

Create the validated agent context, ticket, claim, update, decision, and board system.

## Scope

Use files and standard-library scripts; do not change application behavior or data flow.

## Non-goals

Do not replace the relay risk register or adopt the alternative MVP revision.

## Acceptance criteria

Invalid ticket metadata, dependencies, claims, and updates fail tests and `make check`.

## Test plan

Run dedicated mutation tests, generated views, and the full repository gate.

## Failure behavior

Fail closed: an invalid board cannot render agent context.

## Handoff requirements

Provide the active claim, checkpoint, changed-file list, and narrow/full verification.
