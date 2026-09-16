# Automated accessibility coverage for camera, instructor, and Review surfaces

## Goal

Close the gap where `StudentExperience` had an automated `axe-core` accessibility
check but the instructor capture panel, the new camera consent control, and the
async Review route did not, despite each having ARIA/keyboard behavior worth
machine-checking.

## Changed files

- Added an `axe.run` assertion to `InstructorPanel.test.tsx` in the mid-share
  state (Start clicked, a frame matched).
- Added an `axe.run` assertion to `CameraControl.test.tsx` in the camera-on
  state.
- Added an `axe.run` assertion to `ReviewExperience.test.tsx` against the
  default multi-concept render.

All three follow the same rule exceptions `StudentExperience.test.tsx` already
established (`region` and `color-contrast` disabled — jsdom does not compute
real layout or contrast, so those rules only produce noise there).

## Validation evidence

20 tests pass across the three affected files; full `npm run typecheck` and
`make check` (memory, delivery board, pack, relay, extension, live-session) are
green. No markup changes were required — all three surfaces already passed.

## Data and scope boundary

Test-only change. No contract, event, or transport code touched.

## Blocker

None for this slice. This is automated coverage only; it does not satisfy T-09's
open requirement for a human accessibility/formative reviewer, which needs a
person, not more automated checks.

## Owner

Codex, at Anurup Kumar's direction (AL-047).

## Next action

None required to close AL-047 itself. The next accessibility-relevant work is
still T-09 (finding a human reviewer) and the real-device screen-reader/keyboard
QA already tracked in `docs/DEMO_PROOF_SPRINT.md`.
