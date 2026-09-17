# Approval-gated class library assistant

## Goal

Deliver AL-056's safe, additive class-library slice without treating the
repository's existing authoring/RAG code as approval to activate real course
content.

## Changed files

- Added class invite, membership, archive, cited-fact, and student-Q&A API
  contracts and AWS routes/tables/least-privilege grants.
- Added server-owned membership checks, expiring/revocable invites, cited-only
  answers, provisional/published fact precedence, and metadata cleanup.
- Restricted new library materials to PDF intake under a quarantine prefix;
  Poppler indexing now creates deterministic cited draft schedule/recap facts
  only from explicit page text.
- Added extension-local confirmed task saving; it has no network client.

## Validation evidence

`npm run typecheck`, `cd infra && npm run typecheck`, and nine focused Vitest
files (34 tests) pass. The suite covers PDF spoofing/size guards, citations,
fact precedence, invite revocation, archive, purge, source mismatch, and local
task persistence. The generated OpenAPI contract is in sync.

## Blocker

The course assistant deploy flag is false by default. Enabling real instructor
material still needs the human privacy/retention decision, OAuth client setup,
and an explicit deployment change. The live semantic relay remains separate.

## Owner

Codex, at Anurup Kumar's direction; ticket AL-056.

## Next action

Run the full repository gate and CDK synth, then have a human review the
production activation prerequisites before any real course material is loaded.
