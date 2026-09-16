# Remove the T-29 implementation block

## Goal

At the user's direction, preserve the critique and alignment material for the
team's in-person meeting while removing the rule that prevented scoped work
tonight.

## Changed files

- `AGENTS.md` and `CLAUDE.md` — replace the hard stop with a non-blocking
  review requirement for product-direction changes.
- `docs/TEAM_ALIGNMENT_CHECK.md` — changes status and agent guidance to a
  meeting agenda rather than an implementation gate.
- `docs/CONTEXT_RELAY.md` — T-29 evidence and RL-030.
- `memory/INDEX.md` — points to this record.

## Decision

Scoped work against the current extension-first MVP may continue. Product
direction, demo-claim, privacy-boundary, and MVP-scope changes remain topics
for tomorrow's in-person team meeting.

## Validation evidence

`python3 scripts/relay_check.py`, `python3 scripts/memory_check.py`, and
`make check` validate the revised documentation state.

## Blocker

There is no implementation blocker from T-29. The team still needs to resolve
the critique/revision discussion before adopting a different product direction.

## Owner

Anurup Kumar, at the user's explicit direction.

## Next action

Continue scoped current-MVP work tonight; discuss and record the product
direction decision in person tomorrow.
