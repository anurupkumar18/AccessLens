---
id: AL-014
title: Human reviewed AI draft generation
status: BLOCKED
priority: P1
depends_on: [AL-013]
task_ids: []
threads: []
affected_paths: [services/content-authoring,scripts/build-pack.ts,packages/contracts]
contract_impact: draft generation result schema
data_impact: persistent-instructor-content
demo_impact: Makes Bedrock visible as DRAFT content, never an unreviewed live response.
human_decision: approve model use, draft review policy, and provider credentials
---

## Outcome

Generate structured draft regions and descriptions only after an instructor explicitly requests it.

## Scope

Extract shared generation logic from the CLI and validate model output before it reaches review.

## Non-goals

Do not automatically publish, translate, grade, or generate live lecture descriptions.

## Acceptance criteria

Every generated field is visibly draft and schema-valid before an instructor can edit it.

## Test plan

Use deterministic model-response fixtures and malformed-output rejection tests.

## Failure behavior

Leave the source intact and show a failed draft job; never expose partial unreviewed content to students.

## Handoff requirements

Record prompt/model provenance without persisting secrets or content in logs.
