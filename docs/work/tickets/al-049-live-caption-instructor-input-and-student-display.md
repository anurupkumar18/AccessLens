---
id: AL-049
title: Live caption instructor input and student display
status: IN_REVIEW
priority: P1
depends_on: [AL-048]
task_ids: [A2]
threads: [T-16]
affected_paths: [apps/extension/src/instructor,apps/extension/src/student,apps/extension/src/shared,apps/extension/src/style.css]
contract_impact: none; uses the AL-048 payload as-is
data_impact: temporary-service
demo_impact: an instructor can send a short live caption and a student can see a rolling transcript of the last few, labelled as instructor speech
human_decision: none
---

## Outcome

Wire AL-048's `caption.appended` payload into the product: an instructor
caption input scoped to the current asset, and a bounded, non-persistent
student caption/transcript display gated behind the existing (previously
unused) `captionsEnabled` preference.

## Scope

- `captureController.ts`: `sendCaption(text)` -- requires sharing/paused and a
  currently matched asset, trims and bounds the text to 280 characters,
  rejects empty input, emits `caption.appended` scoped to the current asset.
- `InstructorPanel.tsx`: a caption input + "Send caption" form, shown only
  while sharing with a matched asset, alongside the existing correction and
  region-indication forms. Clears on send.
- `liveState.ts`: `StudentLiveState.captions`, a rolling transcript capped at
  `MAX_RECENT_CAPTIONS` (5), carried through asset/region changes, cleared on
  a fresh `session.started` or on `session.ended`.
- `StudentExperience.tsx`: a `role="log"` caption track shown when
  `captionsEnabled` is true and captions exist, each line labelled as
  instructor speech, not a reviewed description; a "Show instructor captions"
  toggle beside the existing "Reduce motion" toggle.
- `style.css`: `.caption-track` styling matching the existing card/border
  conventions.

## Non-goals

No speech-to-text, no raw audio, no persistence beyond the in-memory rolling
window, no relay or contract change (AL-048 already shipped the payload this
consumes).

## Acceptance criteria

An instructor can type and send a caption while sharing with a matched asset;
it clears the input and is rejected (with a visible error, no event) if empty.
A student with `captionsEnabled` on sees the caption text labelled as
instructor speech; turning the preference off hides the track immediately.
The transcript never exceeds 5 entries and resets when a new session starts.

## Test plan

New tests in `captureController.test.ts` (5), `liveState.test.ts` (3),
`InstructorPanel.test.tsx` (2), and `StudentExperience.test.tsx` (2); full
`npm test` (338 tests), `npm run typecheck`, and `make check`. Manually
verified in the built `dist/` preview that the student-side toggle renders
correctly with no console errors; the instructor-side form could not be
exercised end-to-end in this environment because it requires a real
`getDisplayMedia()` grant, which no sandboxed tool here can provide -- the
same limitation recorded against AL-001/AL-002 capture QA.

## Failure behavior

An over-length, empty, or out-of-context (no current asset) caption attempt
is refused client-side with a visible `role="alert"` message and emits
nothing.

## Handoff requirements

Real-device QA (does the caption track read sensibly with a screen reader,
does the 280-character bound feel right for an actual lecture pace) is part
of the same device QA already tracked in `docs/DEMO_PROOF_SPRINT.md`, not a
new separate requirement.
