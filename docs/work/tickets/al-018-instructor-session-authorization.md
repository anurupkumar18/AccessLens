---
id: AL-018
title: Instructor session authorization
status: BLOCKED
priority: P1
depends_on: [AL-012,AL-017]
task_ids: [A6,A7,A8]
threads: [T-22,T-26]
affected_paths: [services/live-session,services/content-authoring,infra]
contract_impact: authenticated create authorization only
data_impact: temporary-service
demo_impact: Closes the demo-only role-selection weakness without widening student access.
human_decision: approve identity-to-session authorization policy
---

## Outcome

Allow an authenticated instructor to create a session for a selected approved pack version.

## Scope

Preserve short-lived role-scoped student capabilities and semantic-only relay events.

## Non-goals

Do not add student accounts, broad course access, or a public-content claim.

## Acceptance criteria

Students cannot publish or access private libraries and instructors cannot create against unapproved content.

## Test plan

Run authorization, expired-token, replay, and role-escalation tests.

## Failure behavior

Refuse session creation or publish attempts with redacted operational errors.

## Handoff requirements

Require a second security/privacy reviewer before merge.
