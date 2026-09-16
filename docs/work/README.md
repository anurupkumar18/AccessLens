# AccessLens delivery board

This is the repository-native delivery system for human-directed agents. It avoids
one mutable shared board: ticket files state the work, claim files state ownership,
and timestamped update files communicate progress after a pull.

## Start work

```sh
make agent-context
make work-board
```

Choose a `READY` ticket with satisfied dependencies. Create
`docs/work/claims/AL-###.md` and a corresponding `CLAIM` update before editing its
implementation paths. A claim must name the ticket, agent, branch, base commit,
and first checkpoint. Remove the claim only in the merge update or an explicit
handoff; a stale claim is a blocker, not an invitation to duplicate work.

## Ticket front matter

Every ticket contains `id`, `title`, `status`, `priority`, `depends_on`,
`task_ids`, `threads`, `affected_paths`, `contract_impact`, `data_impact`,
`demo_impact`, and `human_decision`. The body supplies outcome, scope, non-goals,
acceptance criteria, test plan, failure behavior, and handoff requirements.

Valid statuses are `BLOCKED`, `READY`, `CLAIMED`, `IN_PROGRESS`, `IN_REVIEW`,
`DONE`, and `DEFERRED`. A ticket may be `READY` only when all dependencies are
`DONE`; an explicitly recorded `dependency_waiver` is the sole exception.

## Immutable update format

Use `docs/work/updates/AL-###-TYPE-YYYYMMDD-HHMM.md`. Its front matter requires
`ticket`, `type`, `status`, `branch`, `commit`, `product_impact`, `demo_impact`,
`data_impact`, `checks`, and `remaining_risk`. Valid types are `CLAIM`,
`CHECKPOINT`, `BLOCKER`, `CONTRACT_DELTA`, `PRODUCT_DELTA`, `DEMO_DELTA`, `MERGED`,
and `HANDOFF`.

Never rewrite a past update. If it became inaccurate, add the next update explaining
what supersedes it. A `CONTRACT_DELTA`, `PRODUCT_DELTA`, or `DEMO_DELTA` must link
its decision or relay thread in the body.

## Human decisions

Agents may implement, test, review, and hand off work. Humans decide product
direction, privacy/identity/retention changes, credential or deployment approval,
mentor/user feedback interpretation, and release/public claims. Record those in
`docs/work/decisions/` and link the ticket.
