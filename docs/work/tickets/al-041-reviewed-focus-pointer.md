---
id: AL-041
title: Reviewed focus pointer
status: IN_REVIEW
priority: P0
depends_on: []
task_ids: [A5,A9]
threads: []
affected_paths: [apps/extension/src/instructor,apps/extension/src/student,apps/extension/src/renderers]
contract_impact: existing optional region.changed.pointer field only; no schema change
data_impact: temporary-service
demo_impact: Lets an instructor explicitly point students to the center of a reviewed region during live semantic sync.
human_decision: user-directed feature-branch prototype scope; no new product claim or retention
---

## Outcome

Complete the existing instructor region-indication control so it sends the
existing optional `region.changed.pointer` coordinate derived from the reviewed
region bounds, and the Focus renderer visibly presents it.

## Scope

Use only the existing reviewed asset/region and optional pointer contract. The
pointer must be calculated from the selected reviewed region, not from raw
screen pixels or browser pointer tracking.

## Non-goals

Do not add raw-coordinate capture, Canvas/RAG, models, camera input, student
tracking, persistence, captions, or any new relay/contract field.

## Acceptance criteria

An active instructor can select a reviewed region and emit an ordered semantic
event with its normalized center pointer. A student following that event renders
the reviewed region and an explicit pointer marker; events without a pointer
continue to render safely without one.

## Test plan

Add controller, live-state, and Focus-renderer tests. Run the focused extension
tests, then `make check` before handoff.

## Failure behavior

Reject a region whose reviewed bounds cannot form a valid normalized pointer;
do not clamp or invent a location.

## Handoff requirements

State that the pointer comes from reviewed pack geometry only and requires
unpacked-extension and multi-device QA before any live-demo claim.
