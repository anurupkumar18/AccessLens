---
id: AL-058
title: Durable class-library deletion jobs
status: IN_REVIEW
priority: P1
depends_on: [AL-056]
task_ids: [R3]
threads: [T-29]
affected_paths: [services/api,services/library/src,services/shared,infra/lib]
contract_impact: profile deletion now archives and returns a durable purge job; a new owner-only status route exposes fixed job states
data_impact: persistent-instructor-content
demo_impact: strengthens an approval-gated synthetic/public pilot; it does not enable real-course data or the assistant feature flag
human_decision: Retention and real-course activation remain subject to the charter's human review and institutional approval; this is implementation-only and remains IN_REVIEW.
---

## Outcome

Replace synchronous class deletion with immediate archive/revocation plus a
durable, idempotent asynchronous purge record that the owning instructor can
read after the profile has been removed.

## Scope

Add the DynamoDB job table, a trusted five-minute cleanup Lambda, fixed safe
job states, a queueing `DELETE` response, and an owner-only status route.

## Non-goals

Do not activate the course assistant, alter live capture or raw-media flows,
retain deletion errors or source contents, implement a new student surface, or
claim institutional/retention approval.

## Acceptance criteria

A delete request archives the class before dispatching cleanup; repeated
requests share one job; the worker removes documents, chunks, vectors, facts,
memberships, and invites; a purge failure is retryable and reports only a fixed
failure code; another instructor cannot read the record.

## Test plan

Unit-test lifecycle transitions and owner-only HTTP responses, regenerate and
test the OpenAPI contract, synthesize the stack, then run `make check`.

## Failure behavior

Dispatch and cleanup fail closed into `dispatch_failed` or `purge_failed`.
The archived profile continues to revoke student access; a later delete request
can requeue a failed job without exposing internal error text.

## Handoff requirements

State that a successful status means the existing document/vector/metadata
teardown completed, while the physical per-instructor bucket and malware scan
remain separate hardening work. State that the feature gate remains off.
