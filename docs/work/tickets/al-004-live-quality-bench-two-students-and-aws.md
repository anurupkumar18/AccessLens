---
id: AL-004
title: Live quality bench two students and AWS
status: BLOCKED
priority: P0
depends_on: [AL-001,AL-003]
task_ids: [A6,A7,A8,A14]
threads: [T-25,T-28]
affected_paths: [services/live-session,tests/e2e,docs/DEMO_RUNBOOK.md]
contract_impact: none
data_impact: temporary-service
demo_impact: Supplies measured ordered-delivery, latency, skew, and reconnect proof.
human_decision: none
---

## Outcome

Measure the real instructor-to-two-student semantic event path under demo conditions.

## Scope

Run 30 ordered region events, measure event-to-render latency and inter-student skew, and exercise reconnect.

## Non-goals

Do not collect student profiles, content bodies, or raw media for measurement.

## Acceptance criteria

Results record 30/30 delivery, latency/skew percentiles, reconnect recovery, and no false-live state.

## Test plan

Run deployed relay integration and a two-device manual bench with redacted artifacts.

## Failure behavior

Record a BLOCKER and use the semantic-event fallback rather than misrepresenting a failed live path.

## Handoff requirements

Link the measurement artifact and release SHA in the demo evidence sheet.
