# Disabled Bedrock gateway placeholder

## Goal

Add the requested model-connection placeholder without activating a provider or
weakening the reviewed-pack-only demo.

## Changed files

- Added `shared/bedrockGateway.ts`, a strict identifier-only interface and the
  only shipped implementation: a disabled gateway that always fails closed.
- Added tests for disabled behavior and rejection of raw screen, identity, and
  course-content-shaped values.

## Validation evidence

The focused gateway suite passed six tests and `npm run typecheck` passed. The
repository-wide check is intentionally deferred to the next feature-batch pass,
per the user-directed productivity plan.

## Data and scope boundary

No SDK, credentials, environment activation, network request, prompt, model
output, Canvas/RAG connection, raw media, student data, or persistent source
content exists in this slice.

## Blocker

An enabled adapter is blocked on explicit model/review/source-data/retention
policy and any required institutional approval.

## Owner

Codex, at Anurup Kumar's direction (AL-042 disabled placeholder).

## Next action

Keep the gateway disabled until the human approval boundary is decided; then
implement the provider only in a separate reviewable backend slice.
