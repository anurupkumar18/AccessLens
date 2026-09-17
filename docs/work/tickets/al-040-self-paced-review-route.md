---
id: AL-040
title: Self-paced Review route
status: IN_REVIEW
priority: P0
depends_on: []
task_ids: [A9,A10,A11,A12,A13]
threads: [T-09]
affected_paths: [apps/extension/src/shell,apps/extension/src/student,apps/extension/src/shared]
contract_impact: none
data_impact: local-only
demo_impact: Demonstrates an asynchronous, clearly non-live route from reviewed pack content only.
human_decision: user-directed prototype scope only; no retention, publication, course data, or release claim
---

## Outcome

Add a separate student Review route that works from the checked-in reviewed Access
Pack without replaying raw media or a live classroom session.

## Scope

Present a clearly non-live, self-paced reviewed concept route with local bookmarks
and the existing local accessibility preferences. It must be useful with the
reviewed demo pack when no Canvas, AWS model, or instructor-published summary is
configured.

## Non-goals

Do not record or replay a professor, retain a semantic event history, integrate
Canvas/RAG, add model generation, introduce learner scoring, or claim an
institutional publishing workflow.

## Acceptance criteria

Students can enter a visibly distinct Review route, step through reviewed concepts,
and store/remove local bookmarks without sending a preference, bookmark, identity,
or raw media through a live event or relay.

## Test plan

Add component and keyboard tests for route distinction, concept navigation, local
bookmark behavior, and the absence of transport changes.

## Failure behavior

When a pack has no reviewed content, show an explicit unavailable state rather
than inventing a summary.

## Handoff requirements

State that this is a checked-in-pack prototype, not an instructor-published
post-class record or Canvas/RAG capability.
