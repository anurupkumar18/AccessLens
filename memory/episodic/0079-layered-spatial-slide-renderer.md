# Layered spatial slide renderer

## Goal

Make the automatic pack-driven AR view feel like the existing movable
mitochondria scene without requiring camera access or inventing slide meaning.

## Changed files

- `apps/extension/src/ar/PackArView.tsx`
- `docs/CONTEXT_RELAY.md`

## Validation evidence

- Focused extension tests: 62 passed.
- Production Vite and orb builds passed.
- The renderer uses the uploaded slide image and asset region bounds for the
  board, raised tiles, connectors, and anchors.

## Blocker

Real-browser capture and cursor synchronization still need manual validation.

## Owner

Codex / Prachi local AR work branch.

## Next action

Open the local extension full-tab instructor view, load a PNG/JPEG, start a new
session, join it in a second tab, and select AR to inspect rotation and focus.
