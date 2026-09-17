# Live caption instructor input and student display

## Goal

Wire AL-048's `caption.appended` payload into the actual product: an
instructor control to send a caption, and a student-facing display of the
recent transcript. Closes the "live captions and transcript" P0 item named in
`docs/ADVANCED_FEATURES.md` (read from `origin/master` for reference only) at
the code level.

## Changed files

- `apps/extension/src/instructor/captureController.ts`: `sendCaption(text)`,
  requiring an active, matched share; trims and bounds to 280 characters;
  emits `caption.appended` scoped to the current asset.
- `apps/extension/src/instructor/InstructorPanel.tsx`: caption input + Send
  form, shown alongside the existing correction/indication forms.
- `apps/extension/src/student/liveState.ts`: `StudentLiveState.captions`, a
  rolling window capped at `MAX_RECENT_CAPTIONS` (5), carried through
  asset/region changes and cleared on a fresh `session.started` or on
  `session.ended`.
- `apps/extension/src/student/StudentExperience.tsx`: a `role="log"` caption
  track (shown when `captionsEnabled` and captions exist) and a "Show
  instructor captions" toggle next to "Reduce motion".
- `apps/extension/src/style.css`: `.caption-track` styling.

## Validation evidence

12 new tests: 5 in `captureController.test.ts` (send, empty rejected,
over-length rejected, no-current-asset rejected, not-sharing rejected), 3 in
`liveState.test.ts` (append without replacing region, cap at 5, clear on
session.started), 2 in `InstructorPanel.test.tsx` (send + clear, empty
rejected with a visible error), 2 in `StudentExperience.test.tsx` (shown and
labelled as speech, hidden when the preference is off). Full suite: 338 tests
pass, `npm run typecheck` clean, `make check` green end to end. Also loaded
the rebuilt `dist/` in the browser preview and confirmed the student-side
"Show instructor captions" toggle renders in the expected place with no
console errors.

## Data and scope boundary

Caption text is instructor-authored (never speech-to-text or raw audio),
bounded to 280 characters, held only in-memory as a capped rolling window,
never written to browser storage, and travels through the same temporary
live-relay path as every other semantic event.

## Blocker

The instructor-side form could not be exercised end-to-end here because it
needs a real `getDisplayMedia()` grant, which no sandboxed tool in this
environment can provide -- the same limitation already recorded against
AL-001/AL-002. Screen-reader behavior of the `role="log"` caption track
(does it announce sensibly, does it interrupt) also needs real-device QA;
it is folded into the existing `docs/DEMO_PROOF_SPRINT.md` device matrix
rather than tracked as a new separate item.

## Owner

Codex, at Anurup Kumar's direction (AL-049, following the `/goal` directive's
live-captions item).

## Next action

Real-device QA per `docs/DEMO_PROOF_SPRINT.md`. No further code is required
to close this ticket's own scope.
