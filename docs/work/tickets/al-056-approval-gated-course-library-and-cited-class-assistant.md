---
id: AL-056
title: Approval-gated course library and cited class assistant
status: IN_REVIEW
priority: P1
depends_on: []
task_ids: [R1, R2]
threads: [T-29]
affected_paths: [services/library,services/api,apps/extension/src/student,infra,packages/contracts]
contract_impact: additive class membership, invite, fact, and cited-answer contracts; no live-event change
data_impact: persistent-instructor-content
demo_impact: An approval-gated synthetic-PDF proof; it must not be claimed as enabled institutional courseware.
human_decision: User-approved implementation of an approval-ready, synthetic/public-content path only; real-course activation remains subject to the charter review gate, retention policy review, and institutional approval where required.
---

## Outcome

Provide private instructor-owned class libraries with class-scoped retrieval,
student membership, cited facts, and local-only student action items.

## Scope

Additive HTTP and extension contracts; PDF-only guarded intake; per-class vector
isolation; no-retention student questions; and explicit archive/delete behavior.

## Non-goals

Do not activate Canvas/LTI, ingest production institutional data, retain student
chat, alter the live relay, transmit raw capture media, or publish answer keys.

## Acceptance criteria

Unauthorized cross-class access fails closed; every student answer is cited or
declined; facts are provisional until published; and action items remain local.

## Test plan

Cover membership, expiry/revocation, PDF guards, retrieval isolation, citation
validation, fact precedence, deletion, and no-network local task persistence.

## Failure behavior

The course assistant is disabled unless the approval-gated deployment flag is
enabled; unavailable or unsupported material returns a plain cited decline.

## Handoff requirements

Link the human decision, relay entry, policy gate, data paths, and validation
evidence. State that production course-content activation is not implied.
