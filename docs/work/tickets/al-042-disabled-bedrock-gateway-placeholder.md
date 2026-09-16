---
id: AL-042
title: Disabled Bedrock gateway placeholder
status: IN_REVIEW
priority: P1
depends_on: []
task_ids: []
threads: [T-29]
affected_paths: [apps/extension/src/shared]
contract_impact: local authoring gateway input boundary only; no live-event or service contract change
data_impact: none
demo_impact: Makes the model-integration boundary explicit without claiming an enabled agent or exposing model output.
human_decision: user-directed disabled placeholder only; model invocation, source-content use, retention, and review policy remain blocked
---

## Outcome

Add a strictly disabled Bedrock gateway interface so later approved authoring work
has one safe seam without allowing an extension build to contact a model.

## Scope

Validate identifier-only authoring requests locally, then return a clear disabled
error. The placeholder must not read environment credentials, create a network
client, send course content, or be used by live student rendering.

## Non-goals

Do not invoke Bedrock, add a model dependency, send a prompt, connect Canvas/RAG,
retain source material, create a draft, or expose AI output to a student.

## Acceptance criteria

The gateway is disabled by construction; valid identifier-only requests fail with
an actionable approval-needed error and identity/raw-media/course-content-shaped
inputs are rejected before any future adapter could receive them.

## Test plan

Add strict-schema and disabled-gateway unit tests. Run the focused gateway tests;
the next repository-wide integration pass will include this slice.

## Failure behavior

Fail closed with a clear message that the reviewed-pack demo remains available
without AI authoring.

## Handoff requirements

State plainly that no Bedrock call, credential lookup, model output, Canvas/RAG
connection, or durable content store exists in this slice.
