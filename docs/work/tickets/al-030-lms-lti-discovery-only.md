---
id: AL-030
title: LMS LTI discovery only
status: DEFERRED
priority: P2
depends_on: [AL-029]
task_ids: []
threads: []
affected_paths: [docs]
contract_impact: proposed integration boundary only
data_impact: persistent-instructor-content
demo_impact: Keeps LMS claims outside the current product and demo.
human_decision: institutional integration approval and least-privilege scope
---

## Outcome

Document an institutional least-privilege LTI discovery plan before any integration work.

## Scope

Name approved data categories, excluded data categories, and institutional contacts.

## Non-goals

Do not scrape Canvas, request production tokens, or build an LMS connector.

## Acceptance criteria

The plan requires institutional approval before any credentials or production data flow.

## Test plan

Review document completeness against the charter's excluded-data categories.

## Failure behavior

Keep the session-code demo path and public/synthetic content.

## Handoff requirements

Link the approval record before a future implementation ticket is created.
