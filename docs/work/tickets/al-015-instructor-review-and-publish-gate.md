---
id: AL-015
title: Instructor review and publish gate
status: BLOCKED
priority: P1
depends_on: [AL-014]
task_ids: []
threads: []
affected_paths: [apps/extension/src/instructor,services/content-authoring,packages/contracts]
contract_impact: publication manifest only
data_impact: persistent-instructor-content
demo_impact: Shows that AI-generated drafts require instructor approval before live use.
human_decision: approve publication roles and review accountability
---

## Outcome

Make draft, review, approved, published, and archived pack states explicit and enforceable.

## Scope

Only approved immutable versions may be selected for a session.

## Non-goals

Do not encode owner identity or review metadata into the student Access Pack.

## Acceptance criteria

An unapproved revision cannot be selected or served to student clients.

## Test plan

Exercise every state transition and unauthorized transition.

## Failure behavior

Fail closed on missing review or version provenance.

## Handoff requirements

Link publication-state tests to runtime delivery work.
