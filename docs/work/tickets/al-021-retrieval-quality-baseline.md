---
id: AL-021
title: Retrieval quality baseline
status: DEFERRED
priority: P2
depends_on: [AL-020]
task_ids: []
threads: []
affected_paths: [services/content-authoring,tests]
contract_impact: retrieval citation metadata
data_impact: persistent-instructor-content
demo_impact: Future evidence for cited course answers, outside the core live lecture loop.
human_decision: approve retrieval scope and source boundary
---

## Outcome

Define measurable retrieval over approved course chunks with source locations and not-found behavior.

## Scope

Use only authorized private course materials and return source-grounded results.

## Non-goals

Do not use the open web, answer keys, or retained student question history.

## Acceptance criteria

Fixture queries report relevance, citations, and safe unsupported responses.

## Test plan

Use synthetic/public corpus fixtures and retrieval regressions.

## Failure behavior

Return not found rather than a plausible uncited answer.

## Handoff requirements

Document corpus, metric, and approved source boundary.
