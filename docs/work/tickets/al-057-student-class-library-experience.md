---
id: AL-057
title: Student class library experience
status: IN_REVIEW
priority: P1
depends_on: [AL-056]
task_ids: [R2]
threads: [T-29]
affected_paths: [apps/extension/src/student,apps/extension/src/shared,apps/extension/src/shell]
contract_impact: extension client for existing approval-gated classroom endpoints only
data_impact: local-only
demo_impact: Enables a synthetic/public class-library pilot after explicit deployment activation; does not authorize real course materials.
human_decision: Follows AL-056's approval-ready synthetic/public-content decision; real-course activation remains gated by the charter review and institutional approval.
---

## Outcome

Let a signed-in student redeem one instructor invitation, ask cited questions
only in that class, and keep confirmed tasks private to their device.

## Scope

Add a third student surface separate from the live relay and Review Mode. It
uses the already-defined classroom API and a separate local Google-session key.

## Non-goals

Do not persist questions or answers in the extension, create student analytics,
change capture behavior, access Canvas, or activate the server feature gate.

## Acceptance criteria

The student can sign in, redeem an invite, ask only the redeemed profile,
see source/page citations and provisional labels, and remove a local task.

## Test plan

Use an injected client to verify invitation redemption, profile-scoped asks,
citation rendering, declines, task persistence/removal, and shell navigation.

## Failure behavior

Missing configuration explains that the feature is unavailable; unauthenticated,
expired, archived, disabled, unavailable, or unsupported paths fail closed.

## Handoff requirements

State that the UI is a client of AL-056, that its Google session is local to
the student surface, and that no real-course activation is implied.
