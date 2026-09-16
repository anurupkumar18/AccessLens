# Durable class-library deletion jobs

## Goal

Complete AL-058: make class deletion observable and retryable without changing
the approval-gated class-assistant data boundary.

## Changed files

- Replaced the synchronous profile-delete response with an archive-first,
  durable deletion job and added an owner-only status endpoint.
- Added a separate trusted Lambda worker and least-privilege CDK permissions
  for library objects, vectors, profile documents, class facts, memberships,
  and invites.
- Added fixed error codes and lifecycle/API/OpenAPI test coverage.

## Validation evidence

Focused deletion, classroom, and OpenAPI tests pass; root and infrastructure
TypeScript checks pass; CDK synth succeeds. Full repository validation remains
the final PR gate.

## Blocker

There is no implementation blocker. Real-course activation remains blocked by
the existing privacy, retention, OAuth, and institutional-review prerequisites.

## Boundary

The course-assistant flag remains disabled by default. No raw media, student
question/answer history, task, or preference is added. The physical
per-instructor bucket and malware scanner are still future hardening work.

## Owner

Codex, at Anurup Kumar's direction; ticket AL-058.

## Next action

Run `make check`, review the dependent PR, and keep real-course activation
blocked on the documented privacy, retention, OAuth, and institutional review.
