---
id: AL-005
title: Demo failure and fallback proof
status: BLOCKED
priority: P0
depends_on: [AL-004]
task_ids: [A14,A16]
threads: [T-09,T-25]
affected_paths: [docs/DEMO_RUNBOOK.md,packages/access-packs/bio-cell-demo,tests/e2e]
contract_impact: none
data_impact: none
demo_impact: Produces an honest recorded fallback for the live demo.
human_decision: release claim approval
---

## Outcome

Rehearse and record the permission-denial, unmatched correction, relay-failure, and semantic replay paths.

## Scope

Produce the fallback only after the live quality bench establishes what is real.

## Non-goals

Do not present replay as live capture or fabricate a successful permission flow.

## Acceptance criteria

The fallback is usable, truthful about replay, and referenced by two timed rehearsal records.

## Test plan

Execute the demo runbook from a clean extension install.

## Failure behavior

Stop the release claim and record the precise unavailable behavior.

## Handoff requirements

Link the recording, rehearsal dates, and approved claim language.
