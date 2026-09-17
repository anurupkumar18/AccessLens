# Independent spatial lesson model

## Goal

Replace the unattractive slide-plus-overlay AR view with a polished movable 3D
lesson composition inspired by educational AR model viewers.

## Changed files

- `apps/extension/src/ar/PackArView.tsx`
- `docs/CONTEXT_RELAY.md`

## Validation evidence

- Pack AR, student, and shell tests: 32 passed.
- Production Vite and orb builds passed.
- The canvas now uses a central core, orbiting region meshes, halos, and depth
  tethers; capture and accessible modes were not changed.

## Blocker

Real-browser visual QA remains manual.

## Owner

Codex / Prachi local AR work branch.

## Next action

Hard-refresh localhost, start a new session, and inspect the independent 3D
model in AR while switching Focus and Read to confirm equivalent meaning.
