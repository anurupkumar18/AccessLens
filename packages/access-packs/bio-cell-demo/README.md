# bio-cell-demo Access Pack

The one reviewed Access Pack the hackathon MVP runs on: five original cell-biology
slides, twelve regions, an original AR cell model whose node names the regions map
onto, and the event fixtures every other workstream tests against.

Owned by **Part 5** in [`docs/PARALLEL_WORKSTREAMS.md`](../../../docs/PARALLEL_WORKSTREAMS.md).
Implementation-plan task **A14**, and the content and simulator half of Part 5.

## What is here

```
pack.json                    reviewed pack: assets, regions, reading order, AR hotspots
slides/                      five original PNG slides (1280x720)
models/cell.glb              original glTF 2.0 cell, one named node per organelle
demo-assets/                 the deliberately UNAPPROVED slide for the failure beat
review/                      content review sheet for a human subject-matter reviewer
fixtures/                    six ordered event scenarios for Parts 2, 3, and 4
fixtures/invalid/            ten single-fault events that must be rejected
tools/                       generators, the validator, and the simulator
PROVENANCE.md                source, licence, and review status of every asset
```

## Using it from another workstream

**Part 3 (student renderers and AR)** — replay a scenario with no instructor and no
AWS in the loop:

```sh
python3 tools/simulate_events.py --scenario happy-path            # whole sequence as JSON
python3 tools/simulate_events.py --scenario happy-path --stream   # one event per line, real pacing
python3 tools/simulate_events.py --list
```

Each scenario file carries an `expectations` list saying what a consumer must do
with it. `fixtures/happy-path.json` walks all five slides and every region,
including the runbook's mitochondrion beat.

**Part 4 (AWS relay)** — the same files are fixture payloads for WebSocket clients.
`fixtures/invalid/` holds ten events with exactly one fault each; every file names
the rule it breaks in `expectedRule`, and `tools/reference_event_check.py` is the
executable statement of those rules until Part 1's Zod contract exists.

**Part 2 (instructor capture)** — `pack.json` carries the matching policy:

```json
"matching": { "algorithm": "dhash12", "hashBits": 132,
              "maxHammingDistance": 26, "minMargin": 14,
              "onNoMatch": "source.unmatched" }
```

A frame matches a reviewed slide only when it is within `maxHammingDistance` bits of
that slide's fingerprint **and** at least `minMargin` bits closer to it than to every
other slide. Otherwise emit `source.unmatched`. `tools/imagehash.py` computes the
fingerprint in ~30 lines of standard library; port it or call it.

Those two numbers are measured, not guessed. `tools/measure_matching.py` runs the
deck through rescaling, JPEG compression, blur, a 2% crop, and exposure change:

| | worst observed |
| --- | --- |
| Distorted reviewed capture, distance to its own slide | 10 bits |
| Distorted reviewed capture, margin over the next slide | 27 bits |
| Unapproved slide, distance to its nearest reviewed slide | 48 bits (margin 3) |

The two closest reviewed slides are 33 bits apart, against a validator floor of
28. Rerun `measure_matching.py` after any slide edit.

## Two additive contract fields

`docs/SYSTEM_DESIGN.md` section 6 shows a hotspot as
`{hotspotId, regionId, nodeName, label}`. Part 3 also needs to know where to put the
camera, so this pack adds two fields that the shared contract does not yet name:

- `arScene.hotspots[].cameraTarget` — a key into the new pack-level `arCameras` map,
  which holds `{position, target, fov}` per named framing.
- `arScene.hotspots[].highlight` — how the AR route marks the node (`"outline"` today).

Both are additive; nothing in the documented schema changes meaning. They need
Part 1 and Part 3 sign-off before the contract freeze closes. `hotspotId` is also
scoped per asset (`cell-slide-03:mitochondrion`) because several slides teach the
same region and `arState.hotspotId` has to resolve to exactly one hotspot.

## Getting the content reviewed (A15)

Open `review/content-review-sheet.html`. Every region is drawn on its slide from
the same normalized bounds a student renderer receives, beside the exact
`shortDescription` and `plainLanguage` a student is given, plus the AR node and
camera each region maps to. The last section lists all 24 student-facing
sentences on their own for reading straight through.

Regenerate with `tools/generate_review_sheet.py`; `make pack-check` fails if the
checked-in page has drifted from `pack.json`.

## Checks

```sh
make pack-check      # from the repository root; also runs inside make check
```

`tests/e2e/fixture-replay.test.ts` replays these fixtures through Part 1's real
`InMemorySessionClient`, so the path from a checked-in fixture to a subscriber
receiving a Zod-validated event is covered today, before the student renderers
exist. It also cross-checks every event against
`tools/check_contract_conformance.py`: that tool reimplements a subset of JSON
Schema so it can run in the Python-only checks, and a reimplementation drifts,
so the test fails if the two validators ever disagree about a single event.

`tools/validate_pack.py` recomputes every fingerprint from the PNG bytes, resolves
every hotspot against the real node list inside `cell.glb`, rejects prohibited
fields, and fails if `PROVENANCE.md` omits any checked-in binary. The guardrail
suite in `tests/access_pack/` additionally mutates the pack twelve ways and asserts
the validator goes red for each, so it cannot rot into a check that always passes.

Regenerating anything: see the commands at the end of [`PROVENANCE.md`](PROVENANCE.md).
Always rerun `tools/generate_pack.py` after touching the slides — a stale
fingerprint fails CI instead of silently mismatching during the demo.

## What this pack does not claim

No external biology instructor or accessibility professional has reviewed the
content yet; implementation-plan task **A15** tracks that. Until it closes, do not
describe the pack as expert-reviewed or accessibility-audited. `pack.json` carries
the same caveat in `review.notes`, and the validator rejects an
`externalSubjectMatterReview: true` claim that does not name a reviewer.
