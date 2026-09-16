---
id: AL-012
title: Instructor identity and private profile foundation
status: DEFERRED
priority: P1
depends_on: []
task_ids: [A6]
threads: [T-22,T-26]
affected_paths: [infra,services/content-authoring,apps/extension/src/instructor]
contract_impact: separate authoring identity model only
data_impact: persistent-instructor-content
demo_impact: Replaces demo-only anonymous session creation only after a reviewed identity decision.
human_decision: approve identity fields, retention, provider, and persistent content boundary
---

## Outcome

Define a separate authenticated instructor identity boundary without creating student profiles.

## Scope

Use one Cognito pool only after the human identity and retention decision is recorded.

## Non-goals

Do not reuse disposable demo relay storage for durable profiles or content.

## Acceptance criteria

Private profile authorization is tested and student access cannot become publisher or library access.

## Test plan

Add authorization and retention tests in the separate content service.

## Failure behavior

Keep the existing anonymous demo path explicitly demo-only until the durable plane is approved.

## Handoff requirements

Require a linked human decision and second privacy reviewer before implementation.
