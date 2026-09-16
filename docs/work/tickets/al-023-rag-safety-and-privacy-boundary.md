---
id: AL-023
title: RAG safety and privacy boundary
status: DEFERRED
priority: P2
depends_on: [AL-022]
task_ids: []
threads: []
affected_paths: [services/content-authoring,docs]
contract_impact: cited-answer privacy boundary
data_impact: local-only
demo_impact: Prevents future course assistance from diluting the safe core product claim.
human_decision: approve RAG policy and retention boundary
---

## Outcome

Specify and test no-uncited-answer, no-open-web, no-answer-key, and no-student-history behavior.

## Scope

Treat safety and privacy behavior as contract requirements, not prompt instructions.

## Non-goals

Do not claim educational correctness or institutional deployment readiness.

## Acceptance criteria

Adversarial tests demonstrate refusal for unsupported and prohibited requests.

## Test plan

Add fixtures for absent citations, external sources, answer keys, and retention attempts.

## Failure behavior

Decline and direct the student to approved course material.

## Handoff requirements

Require a reviewed privacy decision and threat model.
