# Cell slide AR bridge

## Goal

Route the local/uploaded `cell-slide-01` lesson to the existing mitochondria
3D AR scene without changing live lesson transport or accessible renderers.

## Changed files

- `apps/extension/src/student/StudentExperience.tsx`
- `docs/CONTEXT_RELAY.md`

## Validation evidence

- Cell AR, pack AR, student, and shell tests: 34 passed.
- Production Vite and orb builds passed.
- Only cell pack/title/asset identifiers select `CellArView`.

## Blocker

Real-browser visual QA remains manual.

## Owner

Codex / Prachi local AR work branch.

## Next action

Hard-refresh localhost, start a new `cell-slide-01` session, and verify AR
rotation plus the semantic cell controls.
