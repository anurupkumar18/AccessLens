---
id: AL-043
title: Explicit local review progress
status: IN_REVIEW
priority: P1
depends_on: [AL-040]
dependency_waiver: recorded
task_ids: [A9,A10,A11,A12,A13]
threads: []
affected_paths: [apps/extension/src/student]
contract_impact: none
data_impact: local-only
demo_impact: Gives a student a private, self-directed way to mark reviewed concepts explored without creating a score or instructor signal.
human_decision: user-directed advanced-feature prototype; no assessment, retention beyond local storage, or instructor visibility
---

## Outcome

Add an explicit student-controlled Review progress marker for reviewed concepts.

## Scope

Keep a bounded list of concepts the student actively marks as explored in local
extension storage, scoped to one reviewed pack. Explain that it is private and
not a grade, mastery score, activity metric, or instructor-visible signal.

## Non-goals

Do not auto-track time, clicks, modes, attention, correctness, behavior, or
completion. Do not transmit progress, rank students, create a streak, or add a
shared quest/scoreboard.

## Acceptance criteria

A student can mark/unmark the current reviewed concept, see a private count,
and reload the same local pack state. Other packs and every transport surface
remain unaffected.

## Test plan

Add local-storage and Review-component tests, then include the slice in the next
full repository check batch.

## Failure behavior

When local storage is unavailable or invalid, show zero marked concepts and keep
the review content usable.

## Handoff requirements

State that progress is explicitly student-marked, local-only, non-diagnostic,
and neither assessment nor evidence of learning.
