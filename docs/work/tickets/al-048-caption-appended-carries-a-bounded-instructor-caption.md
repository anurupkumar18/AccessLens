---
id: AL-048
title: caption.appended carries a bounded instructor caption
status: IN_REVIEW
priority: P1
depends_on: []
task_ids: [A2]
threads: [T-16]
affected_paths: [apps/extension/src/shared,packages/contracts,packages/access-packs/bio-cell-demo/tools,services/live-session/src,tests/e2e,tests/access_pack]
contract_impact: additive; widens caption.appended to require assetId and caption:{text,isFinal}
data_impact: temporary-service
demo_impact: closes T-16 so a caption event can actually carry a caption; no UI wired to it yet
human_decision: none
---

## Outcome

Close T-16: `caption.appended` was base-only in the discriminated union, so a
caption event could be typed but never actually carry a caption. Widen the
shared Zod contract and its JSON Schema mirror to the shape Part 5's own
fixtures and conformance report already specified:
`{...base, type:'caption.appended', assetId, caption:{text, isFinal}}`.

## Scope

- `apps/extension/src/shared/contracts.ts`: add a `Caption` object
  (`text` 1-280 chars, `isFinal: boolean`) and require `assetId` + `caption` on
  the `caption.appended` branch of `LiveEventSchema`.
- `packages/contracts/live-event.schema.json`: mirror the same per-type
  matrix change, `caption` closed off on every other type.
- Close both `LiveEvent:additional-property:caption` and
  `LiveEvent:forbidden-property:assetId` gaps in
  `check_contract_conformance.py`'s `EXPECTED_GAPS` and in
  `docs/PART5_CONTRACT_CONFORMANCE.md`.
- Fix `check_contract_conformance.py`'s subset validator, which did not
  recognise `maxLength` at all (raised `NotImplementedError` rather than
  silently passing) and did not enforce it once recognised.
- Update stale "T-16 open" comments in `reference_event_check.py` and
  `services/live-session/src/rules.ts` (no functional change needed there;
  both already allowlisted the `caption` field name in anticipation).
- Update `tests/e2e/fixture-replay.test.ts`'s `KNOWN_REJECTED` allowlist now
  that the two previously-rejected `captions` fixture events validate.

## Non-goals

No UI wiring (instructor caption input, student caption display), no speech
recognition, no raw audio capture, no relay code change (none was needed).
Those are separate follow-on slices.

## Acceptance criteria

`check_contract_conformance.py` reports zero gaps for the two caption-related
rows. The `captions` fixture's two `caption.appended` events validate against
both the real Zod schema and the JSON Schema mirror. A caption text over 280
characters, or a caption on any other event type, is still rejected.

## Test plan

`npm test` (326 tests, including the widened `contracts.test.ts` and
`live-event.schema.test.ts` per-type matrices and the fixed
`fixture-replay.test.ts`), `python3 -m unittest discover -s tests/access_pack`
(62 tests, including a new mutation test proving `maxLength` is enforced, not
just accepted as a keyword), and `make check`.

## Failure behavior

An over-length or missing caption is rejected by the contract at the producer
boundary, the same as any other malformed event; nothing downstream can
receive a caption that was never validated.

## Handoff requirements

The next slice wires this into the product: an instructor caption input in
`InstructorPanel`, and a bounded, non-persistent caption/transcript display in
`StudentExperience`, gated behind the existing (currently unused)
`captionsEnabled` preference.
