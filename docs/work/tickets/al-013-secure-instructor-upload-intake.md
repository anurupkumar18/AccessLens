---
id: AL-013
title: Secure instructor upload intake
status: BLOCKED
priority: P1
depends_on: [AL-012]
task_ids: []
threads: [T-26]
affected_paths: [services/content-authoring,infra]
contract_impact: authoring intake contract only
data_impact: persistent-instructor-content
demo_impact: Enables a future reviewed authoring demonstration without using the relay for files.
human_decision: approve upload retention and safety policy
---

## Outcome

Accept instructor PDFs and images through isolated validated intake.

## Scope

Validate type and safety before durable promotion to a private instructor library.

## Non-goals

Do not accept PowerPoint, production course data without approval, or student uploads.

## Acceptance criteria

Invalid or unsafe files never enter durable storage and the result is auditable without logging content bodies.

## Test plan

Use public/synthetic malformed and unsafe fixtures.

## Failure behavior

Reject before promotion with a plain-language instructor error.

## Handoff requirements

Link data retention, object lifecycle, and authorization evidence.
