# Local pack late-tab race

## Goal

Prevent a student tab opened before a local slide upload from fetching the
device-local pack as if it were a published remote pack.

## Changed files

- `apps/extension/src/shell/App.tsx`
- `docs/CONTEXT_RELAY.md`

## Validation evidence

- App and student focused tests: 30 passed.
- The student now re-reads same-origin local storage when matching a live event.
- Published pack fetch behavior remains guarded by the existing matching logic.

## Blocker

The repository-wide typecheck still reports missing AWS SDK modules in the
pre-existing AI gateway package.

## Owner

Codex / Prachi local AR work branch.

## Next action

Refresh both localhost tabs, start a new local slide session, and confirm the
student enters the matching lesson without a `/packs/local-*` request.
