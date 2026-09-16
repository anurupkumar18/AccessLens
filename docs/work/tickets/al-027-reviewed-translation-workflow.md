---
id: AL-027
title: Reviewed translation workflow
status: DEFERRED
priority: P2
depends_on: [AL-015]
task_ids: []
threads: []
affected_paths: [services/content-authoring,apps/extension/src/student]
contract_impact: draft translation provenance
data_impact: persistent-instructor-content
demo_impact: Prevents unsupported automatic translation claims.
human_decision: approve terminology review and language coverage policy
---

## Outcome

Support machine translation only as visibly unreviewed draft content awaiting terminology review.

## Scope

Keep source and translated variants attributable to one approved pack revision.

## Non-goals

Do not perform automatic live translation or assert linguistic accessibility without review.

## Acceptance criteria

Unreviewed translation cannot become a student-visible published pack field.

## Test plan

Test provenance, review transitions, and missing translation fallback.

## Failure behavior

Show approved source language or structured alternative rather than a fabricated translation.

## Handoff requirements

Link reviewer qualifications and terminology-policy decision.
