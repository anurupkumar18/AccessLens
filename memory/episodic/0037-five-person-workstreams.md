# Five-person AccessLens workstreams

## Goal

Divide the AccessLens hackathon implementation into five independently testable
parts with explicit owners, file boundaries, handoffs, and integration checkpoints.

## Changed files

Use one shared contract freeze followed by five workstreams: foundation/contracts,
instructor capture, student accessibility/AR, AWS live transport, and reviewed
content/camera/demo QA. Each workstream has a `Name` placeholder and a dedicated
branch name in `docs/PARALLEL_WORKSTREAMS.md`.

- Added `docs/PARALLEL_WORKSTREAMS.md`.
- Linked it from `README.md` and `docs/IMPLEMENTATION_PLAN.md`.
- Made this record the current handoff in `memory/INDEX.md`.

## Guardrails preserved

AR remains required in the student extension. Camera recognition remains an
advanced source adapter and cannot delay or destabilize the core screen-sharing
demo. All parts remain governed by charter invariants A1–A11.

## Validation evidence

- `python scripts/memory_check.py` passed for 42 memory documents.
- Active local Markdown links resolve.
- `git diff --check` reported no whitespace errors.

## Blocker

Owner names have not yet been filled in. Implementation begins after the team
assigns the five parts and freezes the shared contracts.

## Owner

AccessLens team.

## Next action

Fill in the five owner names, complete the 45-minute contract freeze, and create the
five workstream branches from `accesslens-extension-ar-pivot`.
