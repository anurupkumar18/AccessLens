# Part 2: instructor capture and approved-screen recognition (A3, A4, A5)

## Goal

Deliver Part 2 of `docs/PARALLEL_WORKSTREAMS.md` on
`workstream/2-instructor-capture`, test-first: explicit capture through the
browser chooser only, a local `dhash-v1` slide matcher that never invents a
match, allowlisted event emission through `SessionClient`, and a manual
correction control, all proven by black-box tests that import only the two
public index modules, the shared contracts, and the fixtures.

## Changed files

- `apps/extension/src/sources/screen/` (new): `index.ts`, `fingerprint.ts`,
  `matcher.ts`, `captureHost.ts`, `displayMediaHost.ts`, `sampler.ts`,
  `README.md`, `fingerprint.test.ts`, `displayMediaHost.test.ts`,
  `fixtures/index.ts`, `fixtures/test-pack.json`, `fixtures/slides/*.png`
  (9 clean), `fixtures/slides/demo/*.png` (6 demo-condition variants).
- `apps/extension/src/instructor/` (new): `index.ts`, `captureController.ts`,
  `InstructorPanel.tsx`, `captureController.test.ts`,
  `InstructorPanel.test.tsx`.
- `scripts/generate-slide-fixtures.ts`, `scripts/fingerprint-pack.ts` (new).
- `apps/extension/src/shell/App.tsx` (instructor branch replaced with
  `InstructorPanel`; glue only), `apps/extension/src/shell/App.test.tsx`.
- `package.json`, `package-lock.json`: dev deps `pngjs`, `@types/pngjs`,
  `@types/chrome`, `tsx`.
- `docs/PART2_HANDOFF.md` (new), this record, `memory/INDEX.md` pointer.
- `dist/` rebuilt.

## Validation evidence

- `npx vitest run`: 14 files, 151 tests passing (was 10 files, 98 before
  this work). New: 20 fingerprint/matcher/CLI, 22 controller, 10 panel,
  1 production host; shell test rewritten.
- `npm run check` (typecheck + test + build) and `make check` pass; exact
  output is in the final report for this run.
- Done-when evidence: no capture without permission flow (host call log is
  empty until Start; denied chooser emits nothing); five scripted slide
  changes match under demo conditions (controller test feeds the six
  1280x720 noisy, bezelled variants and asserts exactly five `asset.changed`
  with consecutive sequences); unknown slide produces `source.unmatched` and
  the schema forbids an `assetId` on it; correction emits the intended
  `asset.changed`/`region.changed` IDs; stop and browser stream-end halt
  sampling synchronously and fifty later ticks emit nothing.
- Fixture distance table: max demo self-distance 5, min cross-distance 13,
  twins 0 bits apart (rejected by the ambiguity rule). Threshold 10 and
  margin 4 unchanged; the first fixture set was redesigned instead of tuning.

## Blocker

None for merge. Chrome-dependent behaviour (real `getDisplayMedia()`
chooser, side-panel video sampling, Stop sharing bar) is unverified; the
human checklist is in `docs/PART2_HANDOFF.md`.

## Owner

AccessLens team (Part 2: Jacob).

## Next action

Human runs the Chrome checklist. Part 1 decides `capture.stopped` versus
the `session.ended` mapping for Stop and schedules the offscreen host with
the `offscreen`/`desktopCapture` permissions and second Vite entry. Part 5
fingerprints the reviewed slides with `scripts/fingerprint-pack.ts`,
records the real distance table, and swaps the pack import in `App.tsx`.
