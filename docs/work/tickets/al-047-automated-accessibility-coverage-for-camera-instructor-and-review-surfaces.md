---
id: AL-047
title: Automated accessibility coverage for camera, instructor, and Review surfaces
status: IN_REVIEW
priority: P1
depends_on: []
task_ids: [A15]
threads: [T-09]
affected_paths: [apps/extension/src/instructor,apps/extension/src/student]
contract_impact: none; test-only
data_impact: none
demo_impact: Automated evidence that these three surfaces have no detectable axe violations; not a screen-reader or physical accessibility audit.
human_decision: none
---

## Outcome

Close the automated-accessibility gap on the three student/instructor surfaces
that had manual accessible-name checks but no `axe-core` run: the instructor
capture panel, the new camera consent control, and the async Review route.
`StudentExperience` already had this coverage; the other three did not.

## Scope

Add one `axe.run` assertion per surface, in its representative rendered state
(instructor panel mid-share with a matched frame, camera control while on,
Review route with a multi-concept pack), using the same rule exceptions the
existing `StudentExperience` test already established (`region` and
`color-contrast` disabled, since jsdom cannot compute real layout or contrast).

## Non-goals

Do not claim a screen-reader, keyboard-only, or human accessibility audit.
`axe-core` catches a bounded set of automatically detectable issues; it does not
replace T-09's still-open human review requirement.

## Acceptance criteria

Each of the three surfaces has an `axe.run` test asserting zero violations, and
all three pass against the current markup.

## Test plan

`npm test -- --run apps/extension/src/instructor/InstructorPanel.test.tsx apps/extension/src/instructor/CameraControl.test.tsx apps/extension/src/student/ReviewExperience.test.tsx`,
then `make check`.

## Failure behavior

A caught violation must be fixed in the surface's markup, not silenced by
widening the disabled-rules list beyond the two already justified above.

## Handoff requirements

None outstanding for this slice. T-09's human formative/accessibility review
remains open and is not satisfied by this automated coverage.
