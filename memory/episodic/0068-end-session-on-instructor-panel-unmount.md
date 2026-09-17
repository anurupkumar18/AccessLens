# End the session when the instructor panel unmounts while sharing

## Goal

Fix the sharing bug RL-016 recorded as a known limitation: "Switching role
in the shell disposes the capture silently, which is fine for a demo and
wrong for a product." Found while looking for real, unblocked accessibility
and sharing bugs to fix per the session's `/goal` directive.

## What was actually happening

`InstructorPanel`'s unmount effect called `controller.dispose()`, which
stops local screen-share tracks (so no media leak) but never emitted any
event to the relay. A student's view kept showing the last live moment
indefinitely, with no signal the instructor had left -- a live analogue of
T-28's false-live bug, but for the disconnect case rather than a quiet
period. Confirmed this was a real bug, not a theoretical one, because an
existing `App.test.tsx` test was passing *by relying on* the stale content
still being shown after a same-tab role switch; fixing the bug broke that
test's assertion, which is direct proof of the old behavior.

## Changed files

- `apps/extension/src/instructor/InstructorPanel.tsx`: the unmount cleanup
  now calls `controller.getState()` and, if a session is open and not
  already closed, calls `controller.endSession()` (emitting `capture.stopped`
  then `session.ended`) before `controller.dispose()`.
- `apps/extension/src/instructor/InstructorPanel.test.tsx`: two new tests
  proving the emit-then-dispose order, and that unmounting before Start is a
  no-op.
- `apps/extension/src/shell/App.test.tsx`: restructured the correction-
  following test to use two separate `App` instances sharing one client
  (more realistic than one tab's own role toggle); added a new test that
  directly reproduces the original bug scenario and asserts the fix.

## Validation evidence

342 extension tests pass (3 new), `npm run typecheck` clean, `make check`
green end to end.

## Data and scope boundary

No new event type or contract change -- uses the existing `capture.stopped`/
`session.ended` events exactly as a manual Stop/End Session click already
would.

## Blocker

None. Real-device confirmation (does a student on a second device see the
message promptly) is part of the existing device QA matrix in
`docs/DEMO_PROOF_SPRINT.md`, not a new requirement.

## Owner

Codex, at Anurup Kumar's direction (AL-051, found while executing the
session's `/goal` "fix remaining accessibility and sharing bugs" item).

## Next action

None required to close this ticket's own scope.
