# Part 1 hardening: LiveEvent contract matrix and shell completion

## Goal

Treat Part 1 (A1/A2) as incomplete rather than done, per its own
`docs/PARALLEL_WORKSTREAMS.md` acceptance criteria. Resolve and document the
`source.unmatched` contract-matrix ambiguity before any other implementation,
then close the remaining gaps between the Part 1 "Done when" checklist and
what was actually committed at `df80b5d`.

## Discrepancy found and resolution

`LiveEventSchema` (Zod) and `packages/contracts/live-event.schema.json`
required `assetId` on every event `type`, including `source.unmatched`. That
contradicts `docs/SYSTEM_DESIGN.md` ("Unknown content produces an unmatched
state, never an invented description") and charter invariant A11/the
unmatched-state product invariant: a schema that lets `source.unmatched`
carry an `assetId` lets a future producer accidentally assert a match it
never made. `arState` also appeared in `SYSTEM_DESIGN.md`'s example payload
but had no field in either schema at all.

Resolution (approved before implementation): `LiveEventSchema` is now a Zod
discriminated union on `type`. Only `asset.changed` (requires `assetId`) and
`region.changed` (requires `assetId` + `regionId`, optional `pointer` +
`arState`) may name an asset or region. Every other type -- `session.started`,
`caption.appended`, `capture.paused`, `capture.resumed`, `session.ended`, and
`source.unmatched` -- is base-only and structurally forbidden from carrying
`assetId`/`regionId`/`pointer`/`arState`. `packages/contracts/live-event.schema.json`
mirrors this with `if`/`then` blocks and is contract-tested with ajv
independently of the Zod side. `packages/contracts/access-pack.schema.json`
was also tightened to validate asset/region item shape, which it previously
skipped entirely.

## Changed files

- `apps/extension/src/shared/contracts.ts` -- discriminated-union
  `LiveEventSchema`, new `arState` field.
- `apps/extension/src/shared/contracts.test.ts` -- full per-type matrix
  tests plus a prohibited-field denylist (raw media, identity, diagnosis,
  grading, attention fields).
- `apps/extension/src/shared/preferences.ts` (new) -- local-only
  `StudentPreferencesSchema` and a `chrome.storage.local` wrapper with an
  in-memory fallback for non-extension contexts; never touches
  `SessionClient`.
- `apps/extension/src/shared/preferences.test.ts` (new).
- `apps/extension/src/shell/{App,RoleNav,ErrorBoundary}.tsx` (new) and
  matching tests -- split the former monolithic `main.tsx` into the
  `shell/` ownership boundary the parallel-workstreams plan expects, added
  an accessible error boundary. `main.tsx` is now a thin mount point.
- `packages/contracts/live-event.schema.json`,
  `packages/contracts/access-pack.schema.json` -- rewritten to match the
  Zod contracts; both are now contract-tested with `ajv` (new dev
  dependency, plus `ajv-formats`).
- `Makefile` -- `check` now actually runs `npm run check`; it previously
  only ran `memory-check` with a placeholder comment.
- `docs/PART1_HANDOFF.md` -- rewritten for the hardened state.
- `.claude/launch.json` (untracked, local) -- added a `vite preview`
  config used only to manually verify `dist/`.

No capture, AWS, camera, or AR renderer code was touched, per the task
constraint.

## Validation evidence

- `npx vitest run` -- 76/76 passing (7 files): contract matrix, prohibited
  fields, preferences schema/storage, shell components, and both JSON
  Schema contract tests.
- `npm run check` (test + `vite build`) -- passing.
- `make check` (`memory_check.py` over 43 memory documents + `npm run
  check`) -- passing.
- Manually verified the rebuilt `dist/` via a local `vite preview` static
  server in the sandboxed browser pane: role switch, fixture-event send,
  and student-side following all work with zero console errors. This is
  not a substitute for loading the unpacked extension in real Chrome
  (`chrome://extensions` -> Load unpacked); that step still needs a human
  with a Chrome browser, since this sandbox cannot drive one.

## Blocker

None for this hardening pass. Owner names for Parts 2-5 are still blank in
`docs/PARALLEL_WORKSTREAMS.md`; that assignment is unchanged by this work.

## Owner

AccessLens team (Part 1: Anurup Kumar).

## Next action

A human should do a real `chrome://extensions` unpacked-load pass on the
current `dist/`. Parts 2 and 3 can now rely on the frozen per-type
`LiveEvent` matrix (notably: never attach `assetId` to `source.unmatched`)
and on `StudentPreferencesSchema`/`preferences.ts` for local mode storage.
