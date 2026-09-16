---
id: AL-051
title: End the session when the instructor panel unmounts while sharing
status: IN_REVIEW
priority: P1
depends_on: []
task_ids: [A5]
threads: []
affected_paths: [apps/extension/src/instructor/InstructorPanel.tsx,apps/extension/src/shell/App.test.tsx,apps/extension/src/instructor/InstructorPanel.test.tsx]
contract_impact: none; uses the existing capture.stopped/session.ended events
data_impact: temporary-service
demo_impact: prevents a student view from silently going stale forever when the instructor switches role or lesson pack mid-share
human_decision: none
---

## Outcome

RL-016 (`memory/episodic/0041-part2-instructor-capture.md`) recorded:
"Switching role in the shell disposes the capture silently, which is fine
for a demo and wrong for a product." Fixed it: `InstructorPanel` had a real,
undocumented bug, not just a known limitation. Its unmount cleanup called
`controller.dispose()`, which stops local media tracks but never told the
relay or students anything. Every student's view kept showing the last live
moment indefinitely, with no signal the instructor had left -- discovered by
noticing an existing test (`App.test.tsx`) was asserting on exactly that
stale behavior to make its assertions pass.

## Scope

`InstructorPanel.tsx`'s unmount effect now checks `controller.getState()`
before disposing: if a session is open and not already closed, it calls
`controller.endSession()` first (which emits `capture.stopped` if actively
sharing, then `session.ended`, then closes the client) before releasing local
media. This fires whenever the panel unmounts for any reason -- switching to
Student role, or switching lesson pack (`App.tsx` keys `InstructorPanel` on
`activePack.packId`).

## Non-goals

No new event type, no contract change. Does not address the separate,
already-tracked question of whether role-switching mid-session should be
possible to *resume* rather than always ending it -- that is a product
decision, not a bug fix.

## Acceptance criteria

Unmounting the instructor panel while sharing emits `capture.stopped` then
`session.ended`, in that order, and stops local media tracks. Unmounting
before `Start` emits nothing. A separate student app instance sharing the
same client sees "The instructor ended this session." rather than continuing
to show stale content.

## Test plan

New tests: `InstructorPanel.test.tsx` ("unmounting while sharing ends the
session rather than dropping it silently", "unmounting before Start emits
nothing") and `App.test.tsx` ("switching this tab away from Instructor while
sharing tells students the session ended, not silence"). The existing
`App.test.tsx` correction-following test was restructured to use two
separate `App` instances sharing one client (a more realistic instructor/
student scenario than toggling role within one tab) since it had been
implicitly relying on the silent-disposal bug to keep showing stale content
after a same-tab role switch. Full `npm test` (342), `npm run typecheck`,
`make check`.

## Failure behavior

N/A -- this changes failure/teardown behavior itself, making it honest
instead of silent.

## Handoff requirements

None outstanding. Real-device QA (does a student on a second real device see
the "session ended" message promptly when the instructor switches tabs) is
part of the existing multi-device QA already tracked in
`docs/DEMO_PROOF_SPRINT.md`, not a new separate requirement.
