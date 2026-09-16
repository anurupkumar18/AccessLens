---
id: AL-016
title: Approved audio assets
status: BLOCKED
priority: P1
depends_on: [AL-015]
task_ids: [A11]
threads: []
affected_paths: [services/content-authoring,apps/extension/src/student]
contract_impact: approved audio reference only
data_impact: persistent-instructor-content
demo_impact: Supports student-requested approved audio rather than live generic text to speech.
human_decision: approve durable audio retention and generation costs
---

## Outcome

Generate and serve audio only for approved descriptions and only when a student requests it.

## Scope

Treat audio as a reviewed pack asset with safe unavailable-audio fallback.

## Non-goals

Do not continuously speak over instruction or derive content from student behavior.

## Acceptance criteria

Draft audio cannot reach a student; requested approved audio has a structured-text alternative.

## Test plan

Test approval enforcement, requested playback, and missing asset behavior.

## Failure behavior

Keep structured text available when audio is unavailable.

## Handoff requirements

Record asset authorization and retention policy.
