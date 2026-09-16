---
id: AL-045
title: Disabled course material provider
status: IN_REVIEW
priority: P1
depends_on: []
task_ids: []
threads: [T-29]
affected_paths: [apps/extension/src/shared]
contract_impact: local future-provider input boundary only; no Canvas/LTI, relay, or retrieval contract change
data_impact: none
demo_impact: Makes the course-material approval boundary executable without implying Canvas access or RAG.
human_decision: user-directed disabled placeholder only; institutional Canvas/LTI approval, allowlist ownership, retention, and RAG policy remain blocked
---

## Outcome

Add a no-network, disabled `CourseMaterialProvider` interface that only accepts
allowlisted material references and refuses every retrieval.

## Scope

Represent only a course ID and reviewed identifiers for the permitted categories:
syllabus, module, slide deck, and reference document. Reject assignments,
submissions, quizzes, discussions, grades, answer keys, credentials, raw content,
and student fields before any future adapter receives them.

## Non-goals

Do not call Canvas, use an LTI token, scrape, create an index, retrieve text,
send a prompt, implement RAG, retain materials, or alter the live relay.

## Acceptance criteria

The sole provider shipped by the extension is disabled by construction. Strict
schemas admit only allowed reference shapes; all requests fail closed with an
approval-needed error and no course data leaves the device.

## Test plan

Add strict-schema and disabled-provider tests, then include the slice in the next
full repository batch.

## Failure behavior

Keep the checked-in reviewed Access Pack usable when no institutional provider is
approved or configured.

## Handoff requirements

State that no Canvas/LTI connection, course document, credential, retrieval index,
or RAG response exists in this slice.
