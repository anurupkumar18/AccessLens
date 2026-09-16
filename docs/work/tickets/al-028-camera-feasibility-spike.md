---
id: AL-028
title: Camera feasibility spike
status: DEFERRED
priority: P2
depends_on: [AL-004]
task_ids: [A17]
threads: [T-10]
affected_paths: [apps/extension/src/sources/camera,tests]
contract_impact: none unless a reviewed source-adapter delta is proposed
data_impact: local-only
demo_impact: Stretch proof for a shared instructor device, never a student requirement.
human_decision: approve camera scope and second privacy/accessibility review
---

## Outcome

Evaluate one opt-in shared-device physical-object source that emits the existing semantic event contract.

## Scope

Process locally, ignore faces, require manual correction, and keep screen-sharing demo unaffected.

## Non-goals

Do not record continuously, recognize faces, or require student cameras.

## Acceptance criteria

Permission is explicit, raw frames stay local, and an unmatched/manual fallback works.

## Test plan

Use synthetic/public physical-object fixtures and manual privacy checks.

## Failure behavior

Return to manual instructor selection; do not send media remotely.

## Handoff requirements

Require second human privacy and accessibility review before merge.
