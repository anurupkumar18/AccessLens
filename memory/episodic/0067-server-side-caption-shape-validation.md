# Server-side caption shape validation

## Goal

Close a gap a security review found in AL-048/AL-049 (this session's own
caption feature): the relay validated `pointer` and `arState` shape/bounds
server-side but not `caption`'s, even though the relay's own docstring calls
itself "the only place that can refuse [a hostile or broken client] for
everyone."

## What was found

A security-review subagent, dispatched against the full branch diff, flagged
`services/live-session/src/rules.ts` MEDIUM/8: `caption` was in `KNOWN_FIELDS`
(so its *name* is accepted) but nothing checked that its *value* matched
`{text: string ≤280 chars, isFinal: boolean}`. `relay.ts` forwards a
`checkEvent`-passing event verbatim to every connected student. A client that
speaks the relay's WebSocket protocol directly -- not the vetted extension
build, which does validate client-side via Zod -- could send an oversized or
malformed `caption` and have the relay broadcast it unbounded. Verified this
independently by reading `rules.ts` and confirming there is no ajv/Zod
re-validation anywhere on the actual relay request path; `checkEvent` really
is the only server-side gate.

## Changed files

- `packages/access-packs/bio-cell-demo/tools/reference_event_check.py`: added
  `caption-not-an-object`, `caption-text-missing`, `caption-text-too-long`,
  `caption-isfinal-not-boolean` (source of truth for rule names).
- `services/live-session/src/rules.ts`: mirrored the same four rules, same
  order (the parity test compares ordered arrays, not sets).
- `packages/access-packs/bio-cell-demo/fixtures/invalid/oversized-caption.json`:
  new negative fixture, picked up automatically by the pack's existing
  auto-discovering negative-fixture test suite.
- `services/live-session/test/relay.test.ts`: an integration test proving the
  actual `Relay.publish()` path rejects the oversized fixture, not just the
  rule function in isolation.
- `services/live-session/test/rules.parity.test.ts`: updated the hardcoded
  negative-fixture count from 10 to 11.
- `packages/access-packs/bio-cell-demo/README.md`: updated the stale
  "ten single-fault fixtures" count.

## Validation evidence

339 extension tests, 62 Python pack tests (including the new fixture via
existing auto-discovery), 54 live-session tests (including the new relay
integration test), `npm run typecheck` clean, `make check` green end to end.

## Data and scope boundary

Server-side hardening only. No change to the client-side contract (already
correct) and no change to which event types may carry which fields (that
type-level restriction is deliberately the client contract's job, consistent
with how `pointer`/`arState` were already handled at this layer).

## Blocker

None. This is a defensive fix closing a gap before any real deployment ever
carried a caption -- the deployed AWS endpoint is separately known-stale for
an unrelated reason (T-21/AL-003, rejects `capture.stopped`).

## Owner

Codex, at Anurup Kumar's direction (AL-050, found via a dispatched security
review while following the session's `/goal` directive to run "final
privacy, security, accessibility, and guardrail testing").

## Next action

None required to close this ticket's own scope. General note for future
contract widenings: when a new field is added to `KNOWN_FIELDS` with a
non-trivial shape (an object, not a bare string/number), add a matching
shape check in `rules.ts`/`reference_event_check.py` in the same change,
not as a follow-up someone else has to discover via security review.
