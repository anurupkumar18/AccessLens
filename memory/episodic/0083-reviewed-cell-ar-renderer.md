# Reviewed cell AR renderer

## Goal

Use the existing tested mitochondria-style 3D cell scene for the reviewed cell
lesson without risking generic pack capture or accessibility behavior.

## Changed files

- `apps/extension/src/student/StudentExperience.tsx`
- `docs/CONTEXT_RELAY.md`

## Validation evidence

- Cell AR, pack AR, student, and shell tests: 34 passed.
- The reviewed `bio-cell-demo` selects `CellArView`; other packs remain on
  `PackArView`.
- Typecheck reaches only the pre-existing missing AWS SDK modules.

## Blocker

Real-browser visual QA remains manual.

## Owner

Codex / Prachi local AR work branch.

## Next action

Hard-refresh localhost, start a new cell session, and test AR rotation plus
the equivalent semantic controls.
