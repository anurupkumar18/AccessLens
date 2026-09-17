---
id: AL-010
title: Local reading settings
status: IN_REVIEW
priority: P1
depends_on: []
task_ids: [A1,A9,A10,A11,A13]
threads: []
affected_paths: [apps/extension/src/student,apps/extension/src/shared/preferences.ts]
contract_impact: none
data_impact: local-only
demo_impact: Demonstrates student-controlled access without disclosure.
human_decision: none
---

## Outcome

Add local font, size, spacing, width, contrast, reduced-motion, and read-aloud preferences.

## Scope

Persist settings through the existing local preferences boundary and expose accessible controls.

## Non-goals

Do not send preferences, labels, or mode selection to the relay or instructor.

## Acceptance criteria

Preferences survive reload locally and network/event payload tests prove absence from transport.

## Test plan

Add unit and keyboard tests plus a prohibited-field contract assertion.

## Failure behavior

Default safely when storage is unavailable without blocking structured text.

## Handoff requirements

Record local-only data behavior and affected accessibility routes.
