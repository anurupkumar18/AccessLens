# bio-cell-demo Access Pack, AR model, and event simulator

## Goal

Deliver the content-and-simulator block of Part 5 in `docs/PARALLEL_WORKSTREAMS.md`
(implementation-plan task A14) so Parts 2, 3, and 4 can each test in isolation
before the extension shell, the student UI, or AWS exists.

## Changed files

- Added `packages/access-packs/bio-cell-demo/`: `pack.json`, five original slides,
  `models/cell.glb`, the unapproved demo slide, six ordered event fixtures, ten
  single-fault rejection fixtures, `PROVENANCE.md`, `README.md`, and `tools/`.
- Added `tests/access_pack/test_pack_contract.py`, 34 standard-library tests.
- Added a `pack-check` target to `Makefile` and wired it into `check`.
- Claimed Part 5 and recorded its status in `docs/PARALLEL_WORKSTREAMS.md`.
- Recorded two proposed additive contract fields in `docs/SYSTEM_DESIGN.md`
  section 6 without changing the documented schema.
- Added two risk-register rows to `docs/IMPLEMENTATION_PLAN.md`.
- Pointed `docs/DEMO_RUNBOOK.md` at concrete assets and added fallback replays.

Everything is standard library, including the validator and the tests, because the
only CI job that exists today is the Python documentation check. No JavaScript
workspace was created: Part 1 owns the package-manager choice.

## Findings

The slide fingerprint was the whole risk. An 8x8 average hash left the two closest
reviewed slides 8 bits apart — inside the noise a rescaled capture introduces. A
12x12 row-wise difference hash widened that to 32.

The real defect was subtler. Two implementations of the same reduction disagreed on
two slides, because neighbouring cells inside a flat region of a slide have mean
luminances that tie exactly, and a bare greater-than turns that tie into a coin
flip decided by floating-point summation order. Resolving ties to 0 and requiring a
0.75-of-255 difference to set a bit dropped worst-case drift on a distorted capture
from 38 bits to 10, and raised the worst margin from 19 to 27. The thresholds in
`tools/deck.py` are derived from that sweep, not chosen.

`hotspotId` could not be derived from `regionId`: cytoplasm appears on slides 01
and 03, so `cytoplasm-hotspot` did not resolve to one hotspot pack-wide. The
validator caught it. Ids are now scoped per asset.

## Guardrails preserved

Unknown content emits `source.unmatched` and never a description: the pack pins
`matching.onNoMatch`, and the suite asserts the unapproved demo slide really is
unmatchable (48 bits away against a ceiling of 26). Every region has exactly one AR
hotspot resolving to a real node in `cell.glb`, so the AR route cannot reach less
meaning than the other routes. The validator rejects prohibited fields anywhere in
the pack, and the reference event checker rejects any field not on the contract, so
a mastery, attention, or identity signal fails as an unknown field rather than
needing to be enumerated. The pack states that no external subject-matter review
has happened, and the validator rejects a review claim that names no reviewer.

## Validation evidence

- `make check` passes: memory check plus `validate_pack.py` plus 34 tests, green.
- `tools/measure_matching.py`: across seven capture-style distortions the worst
  reviewed frame lands 10 bits from its own fingerprint and stays 27 bits nearer to
  it than to any other slide; the unapproved slide is rejected under both rules.
- Twelve of the tests mutate the pack and assert the validator goes red, so a
  validator that stopped checking would fail the suite.
- `cell.glb` parses in an independent glTF library (`pygltflib`), exposing the ten
  expected node names.

## Blocker

Two additive contract fields — `cameraTarget` and `highlight` on an AR hotspot,
plus the pack-level `arCameras` map — need Part 1 and Part 3 sign-off during the
contract freeze. Part 3 cannot frame the AR camera without them.

## Owner

Kunj Rathod, Part 5 (content, camera, and demo QA).

## Next action

Get the two additive fields signed off, then run the fixtures through Part 1's Zod
contract once `packages/contracts/` lands. The camera adapter (A17) and the
end-to-end suite (A14-A16) stay unstarted until the extension shell and
`SessionClient` exist; the implementation plan puts camera work in Phase 6.

## Addendum — conformance against Part 1, after merging df80b5d

Part 1's foundation landed while this branch was open. Merged it, then ran the
reviewed pack and all six fixtures through `packages/contracts/` and through the
Zod schema in `apps/extension/src/shared/contracts.ts`. Both project suites are
green after the merge: `make check` (37 tests) and `npm test` (3 tests).

Thirteen gaps, two of which are bugs in the contract rather than gaps in the pack.

`assetId` is `required` on every LiveEvent, so `source.unmatched` cannot be
expressed at all. Charter A9 requires it to name no asset, and the demo's
2:00-2:30 beat depends on that. Fifteen fixture events fail on this alone, and so
do `session.started`, `session.ended`, `capture.paused`, and `capture.resumed`.

`live-event.schema.json` sets `additionalProperties: false` but omits `regionId`
and `pointer`, which the Zod schema accepts. Part 1's own `validEvent` fixture
fails Part 1's own JSON Schema. That artifact is what a service validates
against, where no Zod runtime exists, so Part 4 would reject exactly the events
the extension sends.

`arState` is rejected too, which means the LiveEvent example in `SYSTEM_DESIGN.md`
section 6 does not validate against the contract implementing that document.

Nothing under `packages/contracts/` was changed — Part 1 owns it.
`tools/check_contract_conformance.py` holds the 13 known gaps in an explicit list,
fails on any gap outside it, and prints a notice when one closes; it runs in
`make pack-check`. The report is `docs/PART5_CONTRACT_CONFORMANCE.md`.

## Addendum 2 — after merging c3ddc27 (Part 1 hardening)

Part 1 fixed both correctness bugs this branch reported, and fixed the first one
better than asked: `LiveEventSchema` is a discriminated union per type, so
`source.unmatched` is structurally incapable of naming an asset rather than
relying on producers to omit the field. The JSON Schema mirrors it with ajv
tests.

The more useful half of this pass was discovering that most of the newly
reported event gaps were Part 5's, not Part 1's, and that conforming improved
the design. Four things left the wire: `arState` on `asset.changed` (the pack's
`defaultCamera` already says where to reset), `arState.camera` (derivable by
resolving `hotspotId` in the pack, and duplicating it lets the event and the
reviewed pack disagree), the `source.unmatched` diagnostics (instructor-side UI,
never rendered by a student), and the `redelivery` marker (a transport fact, now
recorded as `redeliveredEventIndices` on the fixture, which makes the
redelivered event byte-identical to the original — a stronger property, with a
test). Event gaps went from 9 to 2.

Ten gaps remain, all requests to widen the contract. The serious one is new:
`access-pack.schema.json` now sets `additionalProperties: false` on the asset
object, which makes `arScene` illegal. AR is a required renderer (A10, A12) and
`SYSTEM_DESIGN.md` §6's own pack example contains `arScene`, so the pack schema
currently forbids the pack from carrying the scene the MVP requires.

The conformance checker's unsupported-keyword guard paid for itself: the new
schema uses `allOf`/`if`/`then`, and the check stopped with "unsupported
keywords" rather than quietly reporting that everything still conformed. The
validator now implements the subset in use, with the guard intact.

One process note: Part 1 also numbered an episodic record 0038, so this record
moved to 0040 to keep the sequence unambiguous.

## Validation evidence (addendum 2)

- `make check` green after the merge: memory, pack validator, conformance, 40
  tests, and Part 1's `npm run check`.
- Conformance went from 13 gaps against `df80b5d` to 10 against `c3ddc27`, with
  4 closed by Part 1 and 9 closed by Part 5 conforming.
- The fixture test for stale ordering caught the redelivery change rather than
  silently passing, which is what it was for.

## Addendum 3 — first end-to-end slice, and a drift guard

Added `tests/e2e/fixture-replay.test.ts`. The student renderers do not exist, but
`InMemorySessionClient` does, so the path from a checked-in fixture to a
subscriber receiving a Zod-validated event is testable now. It covers ordered
delivery, reconnect redelivery as a provable no-op, `close()` stopping delivery,
and capability requests failing after close.

The valuable part is the cross-check. `check_contract_conformance.py`
reimplements a subset of JSON Schema so it can run in the Python-only checks,
and a reimplementation drifts from the thing it imitates. The test runs every
fixture event through Zod — the actual runtime authority — and fails if the two
validators disagree about any single event. The Python tool grew a `--json` mode
emitting one verdict per event for this.

Two attempts were needed to prove the guard works. The first mutation made the
Python checker blind to `additionalProperties`, and nothing failed: the caption
events also trip `forbidden-property` via the `allOf` matrix, so Python still
rejected them and the two validators still agreed. The guard was fine; the
mutation was too weak. Mutations that actually flip a verdict — Python accepting
everything, and Python inventing a gap on `region.changed` — both fire, in both
directions, with the event named.

Writing the test also caught a modelling error in the test itself: the first
version replayed the reconnect redelivery *after* `session.ended` rather than at
its real position in the stream, so it compared against the state left by a
lifecycle event. Fixed to replay in order up to the redelivery point.

`tsconfig.json` gained `tests` in `include`, so these are typechecked.

## Validation evidence (addendum 3)

- `make check` green: memory, pack validator, conformance, 40 Python tests, and
  `npm run check` — typecheck, 105 vitest tests across 11 files, build.
- Drift guard verified against two verdict-flipping mutations, restored after.

## Addendum 4 — making A15 reviewable

A15 asks for review by a biology instructor and an accessibility professional.
Neither can review a `pack.json` and a folder of PNGs, which is a large part of
why that task had not moved. `tools/generate_review_sheet.py` generates
`review/content-review-sheet.html`: every region drawn on its slide from the same
normalized bounds a student renderer receives, beside the exact
`shortDescription` and `plainLanguage` a student is given, plus the AR node and
camera each maps to, and a final list of all 24 student-facing sentences for
reading straight through.

Drawing the boxes from the student-facing bounds is the point. A region whose box
does not sit on the structure it names is a content bug no schema can catch, and
it would send every student to the wrong part of the diagram.

Verified in a browser: the rendered position of all twelve boxes matches
`pack.json` to four decimal places. The first render came out as mojibake — the
page had no charset declaration, which matters more than usual on a page whose
whole job is careful reading of text. It emits a full document shell now, and a
test asserts the charset is there.

`--check` mode and two tests guard it: the checked-in page must equal a fresh
render, and every drawn box percentage must equal its pack bounds. Both were
verified to fail by moving one box twenty percent across its slide.

## Validation evidence (addendum 4)

- 45 Python tests, `make check` green end to end.
- Rendered geometry cross-checked against `pack.json` in a real browser.
- Both new guards verified against a deliberately displaced region box.
