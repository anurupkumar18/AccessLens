---
id: AL-002
title: Harden capture host from matrix findings
status: BLOCKED
priority: P0
depends_on: [AL-001]
task_ids: [A3,A4,A5,A14]
threads: [T-25]
affected_paths: [apps/extension/src/instructor,apps/extension/src/sources/screen]
contract_impact: none unless an observed lifecycle gap requires a delta
data_impact: none
demo_impact: Removes a reproduced live-capture failure before demo release.
human_decision: none
---

## Outcome

Fix only a capture failure reproduced and categorized by AL-001.

## Scope

Preserve explicit permission and local-only frame handling while correcting the host behavior.

## Non-goals

Do not add silent capture, remote media, or arbitrary screen recognition.

## Acceptance criteria

The exact failure is reproduced by test or runbook, fixed, and passes twice on hardware.

## Test plan

Run the narrow capture tests plus the matrix case that exposed the issue.

## Failure behavior

If a contract change is needed, write a CONTRACT_DELTA and block for review.

## Handoff requirements

Record affected source type, fix evidence, and remaining browser limitations.
