# AccessLens agent operating context

Every agent starts from the repository rather than an unavailable chat history.
Run `make agent-context` after pulling the integration branch and before changing
code or documentation. It reports the active product decision, demo contract,
ticket dependencies, claims, checkpoints, and verified baseline.

## Rules

1. Read this file, `AGENTS.md`, then `make agent-context` before choosing work.
2. Claim only a `READY` ticket with all dependencies `DONE` (or explicitly
   waived in the ticket). A `BLOCKED` ticket requires an update, not a workaround.
3. Do not silently change product direction, demo claims, shared contracts,
   privacy boundaries, identity, or retention. Write a decision record and stop
   for human direction where the ticket says a human decision is required.
4. Create an immutable CLAIM update before implementation, a CHECKPOINT after a
   meaningful implementation or verification event, and a HANDOFF before leaving
   incomplete work.
5. Contract and data-boundary changes require a CONTRACT_DELTA update before
   implementation and a second reviewer before merge.
6. Product or demo-flow changes require a PRODUCT_DELTA or DEMO_DELTA update and
   the linked human decision before merge.
7. One agent owns at most one active P0/P1 ticket. The team-wide implementation
   WIP limit is five.

## Alignment status

T-29 remains an open agenda for the in-person product-direction meeting. It is
not an implementation block for the current extension-first MVP. Do not treat an
absent response as permission to adopt the alternative MVP revision, change privacy
rules, or overstate demo evidence.

## Repository communication model

- `docs/work/tickets/` is the canonical delivery backlog.
- `docs/work/claims/` records an active owner without editing a shared board.
- `docs/work/updates/` is append-only agent-to-agent state: claims, checkpoints,
  blockers, contract/product/demo deltas, merges, and handoffs.
- `docs/work/decisions/` holds human decisions that tickets may depend on.
- `docs/CONTEXT_RELAY.md` remains the risk and cross-cutting decision register;
  tickets reference `T-##` threads instead of duplicating them.

`make work-board` and `make agent-context` are generated views. Do not edit their
output as a source of truth.
