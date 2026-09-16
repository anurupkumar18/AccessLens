---
id: AL-022
title: Cited ask this class vertical slice
status: DEFERRED
priority: P2
depends_on: [AL-021]
task_ids: []
threads: []
affected_paths: [apps/extension/src/student,services/content-authoring]
contract_impact: cited answer response contract
data_impact: local-only
demo_impact: Future cited course-assistance proof, not a substitute for live visual meaning.
human_decision: approve question retention and answer behavior
---

## Outcome

Let a student ask a class-context question and receive an approved-source cited answer or decline.

## Scope

Keep question state local by default and show precise citations.

## Non-goals

Do not turn the feature into a general chatbot, tutor, or answer-key tool.

## Acceptance criteria

Every displayed answer cites an allowed source; unsupported prompts decline safely.

## Test plan

Assert citations, unsupported behavior, and absence of question retention.

## Failure behavior

Offer the live structured route and state that approved material does not support an answer.

## Handoff requirements

Require linked retrieval and privacy evidence before review.
