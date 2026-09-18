# Cell deck slide AR variants

## Goal

Give each reviewed Cell Structure slide a distinct spatial AR composition rather
than showing one generic cell model for every slide.

## Changed files

- `apps/extension/src/ar/cellScene.ts`
- `apps/extension/src/ar/CellArView.tsx`
- `apps/extension/src/ar/CellArView.test.tsx`
- `apps/extension/src/student/StudentExperience.tsx`
- `docs/CONTEXT_RELAY.md`
- `memory/INDEX.md`

## Validation evidence

- The five variants are whole cell, nucleus, mitochondria, protein factory, and
  storage/recycling.
- Hotspots cover all reviewed cell-deck regions.
- Focused AR/student tests: 27 passed.
- Production build passed before the final test-only expectation update.
- Focus, Read, and Reading spacing render branches were not changed.

## Blocker

Real-browser visual QA remains manual; the local reviewed deck preview is needed
to confirm each scene during an actual capture session.

## Owner

Codex / Prachi local AR work branch.

## Next action

Open the local Cell Structure deck, start a fresh session, choose AR, and advance
through all five slides to verify the distinct scene and hotspot changes.
