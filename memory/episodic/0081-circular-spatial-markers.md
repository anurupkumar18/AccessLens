# Circular spatial markers

## Goal

Improve automatic slide AR so it resembles the movable mitochondria scene
without changing live capture or student accessibility behavior.

## Changed files

- `apps/extension/src/ar/PackArView.tsx`
- `docs/CONTEXT_RELAY.md`

## Validation evidence

- Pack AR, student, and shell tests: 32 passed.
- Production Vite and orb builds passed.
- Regions now render as spheres, halos, and depth tethers derived from bounds.

## Blocker

Real-browser visual QA remains manual.

## Owner

Codex / Prachi local AR work branch.

## Next action

Hard-refresh localhost, start a new local session, and verify circular marker
rotation and live-region highlighting.
