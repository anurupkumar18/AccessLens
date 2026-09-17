# Explicit local Review progress

## Goal

Give students a self-directed way to mark reviewed concepts explored without
creating surveillance, assessment, or an instructor-facing metric.

## Changed files

- Added pack-scoped, bounded local Review-progress storage.
- Added explicit mark/unmark controls and a private non-grade count to the
  separate non-live Review route.
- Prevented a delayed local-storage read from overwriting a student action.

## Validation evidence

Focused Review-progress/bookmark/component tests passed seven tests and the
extension typecheck passed. The full repository batch is run after this record.

## Data and scope boundary

Only an explicit local concept ID list is stored. No time, click, mode,
attention, correctness, mastery, identity, network event, instructor signal, or
backend record is created.

## Blocker

No code blocker. Reload and keyboard behavior need unpacked-extension QA; no
local count can be called evidence of learning.

## Owner

Codex, at Anurup Kumar's direction (AL-043 local-only prototype).

## Next action

Run the repository check batch, then use a clean unpacked extension to verify
the explicit local behavior before demo rehearsal.
