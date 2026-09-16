---
id: AL-020
title: Approved course material library
status: DEFERRED
priority: P2
depends_on: [AL-013]
task_ids: []
threads: []
affected_paths: [services/content-authoring,infra]
contract_impact: authoring metadata only
data_impact: persistent-instructor-content
demo_impact: Future private pack-library capability; not part of the live demo claim.
human_decision: approve persistent course-content retention and deletion policy
---

## Outcome

Provide attributable, versioned, removable instructor-owned course materials outside the live relay.

## Scope

Keep source files, revisions, and publication manifests private per instructor.

## Non-goals

Do not introduce student data, Canvas scraping, or public library discovery.

## Acceptance criteria

An instructor can list and remove only their own materials with durable deletion evidence.

## Test plan

Test ownership, versioning, deletion, and exclusion from relay payloads.

## Failure behavior

Deny access when ownership or retention state is uncertain.

## Handoff requirements

Require a reviewed retention and threat-model decision before activation.
