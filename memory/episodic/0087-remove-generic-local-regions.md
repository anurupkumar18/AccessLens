# Remove generic local regions

## Goal

Keep Anurup's Focus, Read, and Reading spacing behavior while allowing the
dedicated water-level AR scene to run without exposing generated area text.

## Changed files

- `apps/extension/src/shared/localPack.ts`
- `docs/CONTEXT_RELAY.md`
- `memory/INDEX.md`

## Validation evidence

- Local packs now contain one `whole-slide` placeholder instead of six `auto-area`
  regions.
- The water-level AR route remains selected by its title or filename and uses
  its own three hotspots.
- Focused AR/student tests: 26 passed.
- Production Vite and orb builds passed.

## Blocker

An already stored local pack must be replaced by uploading the image again before
the browser shows the new single-region shape.

## Owner

Codex / Prachi local AR work branch.

## Next action

Refresh the local instructor and student tabs, upload `docs/waterlevel.png` again,
and verify that Read no longer lists six generated areas while AR still opens the
water-level cylinder.
