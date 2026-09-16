---
id: AL-017
title: Runtime approved pack delivery
status: BLOCKED
priority: P1
depends_on: [AL-015]
task_ids: [A2,A6,A8,A9,A10,A11,A12,A13]
threads: [T-19]
affected_paths: [apps/extension/src/shared,apps/extension/src/student,apps/extension/src/instructor,services/content-authoring]
contract_impact: runtime pack resolver and immutable version behavior
data_impact: persistent-instructor-content
demo_impact: Lets an instructor select one approved version while students receive only that version.
human_decision: approve scoped delivery and asset retention model
---

## Outcome

Load an exact approved pack version at runtime while retaining checked-in demo-pack fallback.

## Scope

Keep instructional pack content separate from ownership metadata and fail closed on version mismatch.

## Non-goals

Do not give students broad library credentials or change their local preferences.

## Acceptance criteria

Two students load the same immutable version; unpublished and mismatched packs cannot render.

## Test plan

Test resolver/cache behavior, wrong versions, expired authorization, and offline local demo fallback.

## Failure behavior

Stop rendering mismatched content and request the exact approved version.

## Handoff requirements

Link version validation to T-19 and session-authorization follow-up.
