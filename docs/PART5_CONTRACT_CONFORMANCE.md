# Part 5 conformance report against the Part 1 contracts

**Checked against:** `packages/contracts/*.schema.json` and
`apps/extension/src/shared/contracts.ts` as of **`38542ad`**.
`38542ad` added `RoleCapabilitySchema` and widened `SessionClient`; it left
`AccessPackSchema` and `LiveEventSchema` untouched, so the gap list below is
unchanged from `c3ddc27`.
**Reproduce:** `python3 packages/access-packs/bio-cell-demo/tools/check_contract_conformance.py`
(runs in `make pack-check`).

## Status

`c3ddc27` fixed both correctness bugs this report raised against `df80b5d`.
`LiveEventSchema` is now a discriminated union per event type, so
`source.unmatched` is *structurally* incapable of naming an asset rather than
relying on producers to omit the field — a stronger fix than the one asked for.
The JSON Schema mirrors it and is covered by ajv tests.

| Previously reported | Now |
| --- | --- |
| `assetId` required on every event; `source.unmatched` unrepresentable | **Closed** |
| `live-event.schema.json` rejects `regionId` and `pointer` that Zod accepts | **Closed** |
| No `arState` on the event contract | **Closed** for `region.changed` |
| Pack-level blocks rejected | Open, and now wider — see below |

Part 5 also brought its own events into line rather than asking the contract to
widen for them. Four things the fixtures used to send are gone:

- **`arState` on `asset.changed`** — the contract forbids it, correctly. An
  asset change resets the scene, and the framing to reset to is
  `arScene.defaultCamera` in the pack. The event does not need to restate it.
- **`arState.camera`** — derivable. The renderer resolves `hotspotId` in the
  pack and reads that hotspot's `cameraTarget`. Carrying it on the wire would
  let the event and the reviewed pack disagree about the same fact.
- **`reason`, `nearestDistanceBits`, `correctionAvailable` on
  `source.unmatched`** — instructor-side UI diagnostics. Nothing a student
  renders, so nothing that belongs on the wire.
- **`redelivery` on the reconnect event** — a transport fact, not a property of
  the moment being taught. It now lives on the fixture as
  `redeliveredEventIndices`, which makes the redelivered event byte-identical
  to the original. That is the stronger property: re-applying it is provably a
  no-op. There is a test for it.

Ten gaps remain, all of them requests to widen the contract.

## 1. The pack schema forbids the AR scene — blocks Part 3

`access-pack.schema.json` now sets `additionalProperties: false` on the asset
object as well as the root. That makes `arScene` illegal.

AR is a **required** student renderer — charter A10, implementation-plan task
A12 — and `SYSTEM_DESIGN.md` §6 shows `arScene` in its own documented Access
Pack example. A pack that cannot carry the AR scene cannot drive the renderer
the MVP requires, and Part 3 has nothing to bind a region to a model node with.

| Gap | Count | What it is |
| --- | --- | --- |
| `assets[].arScene` | 5 | Model URI, default camera, and the region-to-hotspot map |
| `assets[].mediaUri` | 5 | Path to the reviewed slide image the fingerprint was taken from |
| `assets[].subtitle` | 5 | Reviewed sub-heading, part of the structured-text route |
| `assets[].regions[].label` | 12 | The region's display name. Distinct from `shortDescription`; it is what the AR hotspot and the Focus header show |

## 2. Pack-level reviewed policy

Root-level `.strict()` rejects four blocks.

| Gap | Why the pack carries it |
| --- | --- |
| `review` | Review status, and the explicit statement that no external subject-matter review has happened. Keeps the demo from overclaiming (charter A11) |
| `matching` | Fingerprint algorithm, hash width, distance ceiling, margin, and `onNoMatch`. Makes the recognition threshold reviewed content rather than a constant compiled into Part 2 |
| `arCameras` | Named `{position, target, fov}` framings that hotspots reference |
| `reservedReadingOrderIds` | The structural entries (`title`) a `readingOrder` may contain besides region ids |

## 3. `caption.appended` cannot carry a caption — **Closed** (2026-09-16, AL-047/T-16)

Was base-only in the discriminated union, so neither the caption text nor the
asset it belongs to could be sent.

| Gap | Count |
| --- | --- |
| `LiveEvent:additional-property:caption` | 2 |
| `LiveEvent:forbidden-property:assetId` | 2 |

Closed exactly as suggested below: `caption.appended` now requires `assetId`
and a `caption: {text, isFinal}` object (`text` bounded to 280 characters,
matching charter A9's instructor-authored-not-invented framing). No relay
change was needed — `services/live-session/src/rules.ts` and
`reference_event_check.py`'s `KNOWN_FIELDS` already allowlisted `caption` in
anticipation of this. `check_contract_conformance.py` now reports zero gaps
for both rows above. See `memory/episodic/0065-caption-appended-payload.md`.

**Shape (as suggested, now shipped):** `{...base, type:'caption.appended', assetId, caption:{text, isFinal}}`.

## 4. Still unpinned: the first sequence number

`sequence` is `nonnegative()` in Zod and `minimum: 0` in the JSON Schema, so 0
is legal. Part 5's simulator starts at 1. Worth pinning before Part 4 builds
ordering and reconnect logic on it. Tracked as **T-15** in
`docs/CONTEXT_RELAY.md`.

## How this is tracked

`tools/check_contract_conformance.py` validates the pack and every fixture event
against the checked-in JSON Schemas and holds the ten known gaps in an explicit
list. It fails on any gap outside that list and prints a notice when one closes.

It implements the JSON Schema subset the contracts use, and **raises rather than
passing** on a keyword it does not handle. That guard has already earned its
keep: when `c3ddc27` rewrote the event schema as an `allOf`/`if`/`then` matrix,
the check stopped with "unsupported keywords: allOf, description" instead of
quietly reporting that everything still conformed.
