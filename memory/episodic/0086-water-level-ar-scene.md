# Water-level AR scene

## Goal

Give the uploaded water-level biology image a dedicated spatial scene like the
reviewed cell lesson while preserving the existing accessible renderers.

## Changed files

- `apps/extension/src/ar/waterLevelScene.ts`
- `apps/extension/src/ar/WaterLevelArView.tsx`
- `apps/extension/src/ar/WaterLevelArView.test.tsx`
- `apps/extension/src/student/StudentExperience.tsx`
- `docs/CONTEXT_RELAY.md`
- `memory/INDEX.md`

## Validation evidence

- Water-level AR and existing cell/student tests: 26 passed.
- Production Vite and orb builds passed.
- The renderer provides a graduated cylinder, three fluid regions, synchronized
  hotspot highlighting, rotation, reset, keyboard controls, and immersive-AR
  detection.
- Other packs retain the pack-driven renderer; unmatched content remains safe.

## Blocker

Real-browser visual QA remains manual. Local routing requires the uploaded title
or filename to contain `water level` or `waterlevel`.

## Owner

Codex / Prachi local AR work branch.

## Next action

Upload `docs/waterlevel.png`, title it `Water Level`, start a fresh local lesson,
and verify AR, Focus, and structured-text equivalence.
