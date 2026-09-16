# AccessLens product reset

## Goal

Make AccessLens the unambiguous hackathon product, center the paired browser
extensions and instructor screen-sharing flow, make synchronized AR part of the
core student experience, keep camera input as the advanced physical-world adapter,
document the stack and architecture, and remove active artifacts that implemented
the superseded coding-practice product.

## Changed files

- Replaced `README.md`, `AGENTS.md`, `docs/VISION.md`,
  `docs/PROJECT_CHARTER.md`, `docs/IMPLEMENTATION_PLAN.md`,
  `docs/TEAM_PRODUCT_DIRECTION.md`, `docs/DISCORD_TLDR.md`,
  `docs/DEMO_RUNBOOK.md`, and `docs/CANVAS_INTEGRATION.md`.
- Rewrote `docs/ACCESSLENS_PROPOSAL.md` around extension-first live sync.
- Added `docs/SYSTEM_DESIGN.md` with component diagrams, data contracts, failure
  behavior, technical stack, examples, and camera boundaries.
- Removed the old API, web app, plugin, coding fixtures, obsolete product guides,
  superseded research/plans, deployment file, and binary project brief.
- Updated the GitHub workflow and pull-request template for the AccessLens plan and
  removed the obsolete repository-specific delivery skill.
- Updated `memory/INDEX.md`; retained older memory records as historical evidence.

## Validation evidence

- Active local documentation links resolve.
- No active build instructions reference the superseded workflow.
- No prohibited project-comparison references remain in active documentation.
- Memory validation passed for 41 documents.
- Whitespace validation passed after formatting cleanup.

## Blocker

The extension and AWS session service are not implemented. Production Canvas/LTI
access remains institutionally gated. Relevant student and accessibility design
partner validation is still needed before impact claims. An ignored legacy
`apps/api/.pytest_cache` directory and bytecode files remain in the local workspace
because Windows denied access even to an elevated, path-validated cleanup; they are
not tracked product source and do not appear in Git changes.

## Owner

AccessLens team.

## September 15 scope correction

Branch `accesslens-extension-ar-pivot` records the owner's correction that both
roles are extension surfaces, AR is required in the MVP, and camera-based
recognition is the advanced physical-world input adapter. AR and camera input are
separate architectural concerns; immersive WebXR may use a local device camera for
compositing without making that feed an AccessLens recognition source.

## Next action

Implement Phase 1 tasks A1 and A2: load a Manifest V3 extension with Instructor and
Student roles and validate one checked-in biology Access Pack locally.
