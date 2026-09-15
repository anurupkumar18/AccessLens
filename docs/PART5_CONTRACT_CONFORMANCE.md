# Part 5 conformance report against the Part 1 contracts

**Date:** September 15, 2026
**Checked against:** `packages/contracts/access-pack.schema.json`,
`packages/contracts/live-event.schema.json`, and
`apps/extension/src/shared/contracts.ts` as of `df80b5d`.
**Reproduce:** `python3 packages/access-packs/bio-cell-demo/tools/check_contract_conformance.py`

The reviewed `bio-cell-demo` pack and its six event fixtures were run through
Part 1's contracts. The pack is one top-level block away from conforming. The
event contract, however, cannot currently express two things the charter and the
system design require, and its two artifacts disagree with each other.

Part 1 owns `packages/contracts/`, so nothing in that directory was changed.
This file records the discrepancy and the intended observable behaviour, per the
working agreement in `AGENTS.md`.

## 1. `source.unmatched` is unrepresentable — charter A9

Both artifacts list `assetId` in `required`. The whole point of
`source.unmatched` is that there is no approved asset to name: charter invariant
A9 says unknown content produces an unmatched state and never an invented
description, and the 2:00–2:30 beat in `DEMO_RUNBOOK.md` depends on it.

```
LiveEventSchema.safeParse({schemaVersion:'1.0', type:'source.unmatched', ...})
  -> assetId: Invalid input: expected string, received undefined
```

The same requirement also rejects `session.started`, `session.ended`,
`capture.paused`, and `capture.resumed`, none of which name an asset either. 15
of the events across the six fixtures fail on this alone.

**Intended behaviour:** `assetId` is required for `asset.changed`,
`region.changed`, and `caption.appended`, and absent for the session-lifecycle,
capture, and unmatched events. A discriminated union on `type`, or moving
`assetId` out of the top-level `required` list and enforcing it per type, both
express that.

## 2. `arState` is rejected, but AR is a required renderer

Neither artifact names `arState`, and both reject unknown fields
(`.strict()` in Zod, `additionalProperties: false` in JSON Schema). AR is a
required student renderer in the MVP — charter A10, implementation-plan task
A12 — and `SYSTEM_DESIGN.md` section 6 shows `arState` in its own documented
LiveEvent example.

That example therefore fails the contract that implements the document it comes
from:

```
SYSTEM_DESIGN LiveEvent example -> FAIL  <root>: Unrecognized key: "arState"
```

**Intended behaviour:** `arState` is an optional object of
`{hotspotId, action, camera}`. Part 3 has nothing to drive the AR camera and
highlight from without it.

## 3. The Zod authority and the JSON Schema artifact disagree

`live-event.schema.json` sets `additionalProperties: false` and does not list
`regionId` or `pointer`, both of which the Zod schema accepts and both of which
appear in Part 1's own canonical fixture. Part 1's `validEvent` fails Part 1's
own JSON Schema:

```
validEvent fields absent from live-event.schema.json properties: [ 'regionId', 'pointer' ]
```

This matters because the JSON Schema is the artifact a service validates
against, where no Zod runtime exists. Part 4 would reject the events the
extension sends. `PART1_HANDOFF.md` describes the JSON Schema as "the
interchange contract for future service validation", which is exactly the use
that breaks.

**Intended behaviour:** the two artifacts agree, ideally by generating the JSON
Schema from the Zod schema rather than maintaining both by hand.

## 4. Pack-level fields the contract does not model

`AccessPackSchema` is `.strict()` at the top level and rejects four blocks the
reviewed pack carries. Asset-level and region-level extras (`mediaUri`,
`subtitle`, `arScene`, region `label`) are accepted today, because the inner
object schemas are not strict — worth knowing, since tightening them later would
break the pack.

| Block | Why the pack carries it |
| --- | --- |
| `review` | Review status and the explicit statement that no external subject-matter review has happened. Keeps the demo from overclaiming. |
| `matching` | Fingerprint algorithm, hash width, distance ceiling, margin, and `onNoMatch`. Makes the recognition threshold reviewed content rather than a constant compiled into Part 2. |
| `arCameras` | Named `{position, target, fov}` framings that hotspots reference. Reviewed instructional framing. |
| `reservedReadingOrderIds` | The structural entries (`title`) that a `readingOrder` may contain besides region ids. |

**Intended behaviour:** these are additive and optional; nothing in the
documented schema changes meaning.

## Summary of the requested contract changes

1. Stop requiring `assetId` on every event; require it per event type.
2. Add optional `arState` to the event contract.
3. Reconcile `live-event.schema.json` with the Zod schema — at minimum add
   `regionId` and `pointer`.
4. Allow the four optional pack-level blocks above.
5. Scope `hotspotId` per asset (`cell-slide-03:mitochondrion`). Several slides
   teach the same region, so a region-derived id does not resolve to one hotspot
   pack-wide, and `arState.hotspotId` must.

Items 1 and 3 are correctness bugs in the current contract. Items 2, 4, and 5
are the additive fields Part 5 flagged before the contract landed.

## How this is tracked

`tools/check_contract_conformance.py` validates the pack and every fixture event
against the checked-in JSON Schemas and holds the 13 known gaps in an explicit
list. It fails on any gap outside that list, so a new incompatibility cannot
appear unnoticed, and prints a notice when a documented gap closes. It runs in
`make pack-check`.
