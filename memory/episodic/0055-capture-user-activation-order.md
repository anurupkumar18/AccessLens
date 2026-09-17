# Capture user-activation ordering

## Goal

Make the existing explicit Start flow retain the browser user activation required
to offer tab, window, and display sharing while awaiting a temporary session.

## Changed files

- `captureController.ts` starts the explicitly user-triggered capture chooser
  before awaiting `SessionClient.create()`, then creates the temporary session
  only after capture is granted. If create fails, the stream is stopped before
  returning the UI to idle.
- `captureController.test.ts` asserts both the capture-request order and that a
  temporary session waits for the instructor's grant.

## Validation evidence

Focused controller tests passed (25), followed by full `make check`: 61 Access
Pack, 24 relay, 5 delivery-board, 288 extension, and 53 live-session tests. The
checked-in unpacked-extension build was regenerated.

## Blocker

Unit tests cannot grant a browser permission or select tab/window/display. The
Windows device/browser/source matrix and two-device delivery proof remain
operator-only work.

## Owner

Codex, integrating the narrowly scoped upstream Part 2 capture fix on Anurup
Kumar's QA branch.

## Next action

Run focused capture-controller tests and the full gate, then record the exact
physical Windows results in `docs/DEMO_PROOF_SPRINT.md`. Any reproduced capture
failure becomes AL-002 rather than an ad-hoc follow-up.
