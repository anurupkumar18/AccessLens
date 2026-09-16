# Disabled course material provider

## Goal

Create the requested Canvas/course-material prerequisite without accessing a
course system or starting RAG before institutional approval.

## Changed files

- Added a strict, content-free course-material reference and lookup boundary.
- Added the sole shipped provider: a disabled, no-network implementation.
- Added tests that reject excluded assignments, raw content, credentials, student
  identity, and cross-course references before an adapter could receive them.

## Validation evidence

The focused course-material/Bedrock gateway suite passed 12 tests and extension
typecheck passed. The full repository batch runs after this record.

## Data and scope boundary

No Canvas/LTI client, token, source document, course content, retrieval index,
RAG response, model request, student data, or persistent store exists.

## Blocker

Any actual adapter remains blocked on institutional approval, least privilege,
documented allowlist ownership, retention/deletion policy, and second review.

## Owner

Codex, at Anurup Kumar's direction (AL-045 disabled placeholder).

## Next action

Run the repository batch, then retain the checked-in reviewed-pack fallback until
the institution approves a separate backend implementation.
