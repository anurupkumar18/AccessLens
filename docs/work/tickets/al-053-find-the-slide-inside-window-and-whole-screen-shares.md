---
id: AL-053
title: Find the slide inside window and whole-screen shares
status: IN_REVIEW
priority: P0
depends_on: []
task_ids: [A4]
threads: [T-34]
affected_paths: [apps/extension/src/instructor,apps/extension/src/sources/screen]
contract_impact: none
data_impact: none
demo_impact: window and screen shares can now actually match a reviewed slide; before this, only tab shares ever synced
human_decision: none
---

## Outcome

Integrated from `ui/blacksmith-revamp` (Omar Rizwan, commit `8fde5aa`): only
tab shares ever synced. The pack fingerprints cover the slide image alone; a
shared window adds the viewer's toolbar and margins, and a shared screen adds
the menu bar, dock, and other windows -- both push the whole-frame
fingerprint well past the match threshold. This was a real, reproducible gap
directly blocking AL-001's capture matrix (which explicitly needs tab,
window, and display cases).

## Scope

When the browser reports a `window` or `monitor` surface, the controller now
searches for a 16:9 rectangle inside the frame using a summed-area table of
luminance, then re-fingerprints the winner from the frame's own pixels. Tab
shares (and any surface the browser doesn't report) keep the original
whole-frame path. Candidates are ranked and accepted by set-bit overlap
(>= 0.6) and must clear 0.75x the pack threshold with the pack margin, with a
fresh search required to agree on two consecutive samples before it's
accepted -- tuned against the false-match rate the first version had (~90
false positives on non-slide content). The instructor banner now names what
surface is shared and, when a window or screen shows no reviewed slide,
suggests what usually fixes it.

## Non-goals

Not yet run against a real `getDisplayMedia()` window or screen -- that's
AL-001's real-device matrix, still open. This is the matching-logic fix; the
physical hardware proof is separate.

## Acceptance criteria

A reviewed slide inside a window or full-screen share is found and matched;
non-slide window/screen content does not falsely match.

## Test plan

Merged onto this branch with `InstructorPanel.test.tsx`, `captureController.test.ts`,
and a new `locate.test.ts` (6 tests, including a fixed reproduction of the
original bug: a slide inside a viewer window fingerprints 31 bits from
itself over the whole frame, past the 26-bit threshold). One `locate.test.ts`
case was flaky under `make check`'s full parallel test-worker load (passed
consistently in isolation, ~7.7s alone, but hit Vitest's 5s default twice in
a row under load) -- gave it an explicit 20s timeout rather than leaving an
intermittently red gate. Full `npm test` (354), `npm run typecheck`,
`make check` -- all green, reproduced twice after the timeout fix.

## Failure behavior

An unmatched window/screen share shows the existing Unmatched state plus a
hint ("make the slide bigger and keep other windows off it, or share the
tab..."); it never invents a match.

## Handoff requirements

Real-device verification against actual window/screen `getDisplayMedia()`
captures is part of AL-001's existing matrix, not a new requirement.
