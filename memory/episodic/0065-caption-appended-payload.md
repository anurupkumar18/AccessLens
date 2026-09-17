# caption.appended carries a bounded instructor caption

## Goal

Close T-16: `caption.appended` was in the event-type enum but base-only in the
discriminated union, so a caption event could never actually carry a caption.
`docs/PART5_CONTRACT_CONFORMANCE.md` had documented the exact intended shape
since Part 5 first wrote the `captions` fixture scenario; this closes it.

## Changed files

- `apps/extension/src/shared/contracts.ts`: added a strict `Caption` object
  (`text` 1-280 chars, `isFinal: boolean`) and widened the `caption.appended`
  branch of `LiveEventSchema` to require `assetId` and `caption`.
- `packages/contracts/live-event.schema.json`: mirrored the same per-type
  matrix change with a new `allOf` branch; every other event type explicitly
  forbids `caption`.
- `packages/access-packs/bio-cell-demo/tools/check_contract_conformance.py`:
  removed the two now-closed gaps from `EXPECTED_GAPS`; added `maxLength` to
  `SUPPORTED_KEYWORDS` and actually enforced it (it was accepted as a schema
  keyword but silently unchecked before this).
- Updated stale "T-16 open" comments in `reference_event_check.py` and
  `services/live-session/src/rules.ts` — neither needed a functional change,
  both already allowlisted `caption` by field name in anticipation.
- `tests/e2e/fixture-replay.test.ts`: the two previously-`KNOWN_REJECTED`
  `captions` fixture events now validate; the allowlist is empty.
- Test coverage added in `apps/extension/src/shared/contracts.test.ts`,
  `packages/contracts/live-event.schema.test.ts`, and a new mutation test in
  `tests/access_pack/test_pack_contract.py` proving the new `maxLength`
  enforcement can actually fail (not just be accepted as a keyword).

## Validation evidence

326 extension tests pass (`npm test`), 62 Python pack tests pass
(`python3 -m unittest discover -s tests/access_pack`), and `make check` is
green end to end (memory, delivery board, pack, relay, extension,
live-session).

## Data and scope boundary

Caption text is instructor-authored, bounded to 280 characters, and travels
through the same temporary live-relay path as every other semantic event — no
raw audio, no speech-to-text, no new persistent store. This is a contract
change only; nothing in the product UI reads or writes a caption yet.

## Blocker

None for the contract itself. The next slice needs an instructor caption
input (`InstructorPanel`) and a student caption/transcript display
(`StudentExperience`), gated behind the existing `captionsEnabled` preference
in `apps/extension/src/shared/preferences.ts`, which has been unused dead
groundwork until now.

## Owner

Codex, at Anurup Kumar's direction (AL-048, following the `/goal` directive's
"fix remaining accessibility and sharing bugs" / live-captions item from
`docs/ADVANCED_FEATURES.md`).

## Next action

Wire the widened contract into the instructor and student UI in a follow-on
ticket (AL-049).
