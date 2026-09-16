---
id: AL-001
title: Real-device capture matrix
status: IN_PROGRESS
priority: P0
depends_on: []
task_ids: [A3,A4,A5,A14]
threads: [T-25]
affected_paths: [apps/extension/src/instructor,docs/DEMO_RUNBOOK.md]
contract_impact: none
data_impact: none
demo_impact: Proves the required explicit capture beat on real hardware.
human_decision: none
---

## Outcome

Record repeatable real-browser evidence for tab, window, and display capture.

## Scope

Exercise permission denial, source closure, focus switching, matching, correction,
pause, and stop on the supported demo devices.

## Non-goals

Do not alter capture behavior before an observed failure is categorized.

## Acceptance criteria

The matrix names device/browser/source/result and records two successful core runs.

## Test plan

Use the manual runbook and existing capture/matcher tests; attach result evidence.

## Failure behavior

Open a BLOCKER update and hand the reproducible failure to AL-002.

## Handoff requirements

Link the matrix and exact environment to the next capture ticket.
