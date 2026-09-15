# Context relay document and handover gate

## Goal

Give any incoming contributor — human or another team member's agent — one file
that carries the project's live state, its open threads, and the decisions
already settled, so context survives between sessions and nothing quietly falls
through the gap at the end of the hackathon.

## Changed files

- Added `docs/CONTEXT_RELAY.md`: read order for an incoming agent, a per-part
  state table, an open-threads register, decisions in force, superseded context,
  per-part getting-started instructions, an append protocol, and an append-only
  relay log.
- Added `scripts/relay_check.py`, wired into `make check` as `relay-check`, plus
  a `freeze-check` target.
- Put the relay first in the `AGENTS.md` read order and required a log entry on
  the way out; linked it from `README.md` and `memory/INDEX.md`.

## Findings

Writing the register surfaced six loose ends nobody had recorded, four of them
unowned. Three of five parts have no owner. CI does not run on the integration
branch at all: `.github/workflows/check.yml` pushes only on `[main, master]`, and
no check ran on PR #4. Part 1's `npm run check` never runs on any PR, because CI
runs `make check`, which is Python-only. `codex/live-workspace-foundation` is
three commits ahead from the superseded product and nobody has decided its fate.
Nobody owns the final merge of the integration branch into `master`, which the
build rules forbid doing until the end — so it is an action with no owner and no
defined moment.

The unowned rows are the real hackathon risk. The contract bugs are tractable
and have names against them; the staffing and CI gaps do not.

## Guardrails preserved

The relay does not restate the charter, it points at it, so there is no second
copy of the invariants to drift. Section 4 names decisions that must not be
re-litigated, each with where it was decided, including that AR is required and
that unmatched content is never described. Section 5 marks the Evidence Engine
history as non-requirements so an agent cannot mine it for scope.

## Validation evidence

- `make check` passes: memory check and relay check.
- The checker was tested against nine mutations of the document; the first run
  caught eight. The miss was an asymmetric owner/status rule — it rejected an
  `UNOWNED` owner beside a real status but accepted a real owner beside an
  `UNOWNED` status. Made the rule symmetric; all nine are now caught.
- `make freeze-check` currently exits 1, naming three unowned parts and fourteen
  unsettled threads. That is the intended state today.

## Blocker

Three parts unowned (T-01) and CI not running on the integration branch (T-07)
are both unowned, and neither can be fixed by the content workstream alone.

## Owner

Kunj Rathod, Part 5, acting cross-cutting.

## Next action

Get names against T-01, T-07, T-08, T-12, and T-13 at the next standup. Run
`make freeze-check` at feature freeze; it must exit 0 before the repository is
handed over.
