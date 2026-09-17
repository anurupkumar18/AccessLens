# Local reading settings

## Goal

Complete AL-010's student-controlled reading controls without widening capture,
event, relay, identity, or retention behavior.

## Changed files

- Local preferences now include neutral font choice, line spacing, reading width,
  higher contrast, and read-aloud speed, alongside the existing text size and
  reduced-motion controls.
- Older saved settings safely receive defaults for the new fields.
- Student controls are native labelled inputs. The selected presentational values
  apply only within the student renderer.
- Read-aloud remains user-requested; the selected rate is set only after Play is
  pressed.

## Privacy and contract boundary

Preferences remain in extension-local storage. The shared event schema rejects a
preference-shaped field, and this change does not modify `LiveEvent`,
`SessionClient`, capture, the relay, AWS, raw-media handling, identity, analytics,
or retention.

## Validation evidence

Focused typecheck and tests passed: 33 tests across preferences,
`StudentExperience`, and `AudioView`. Full `make check` then passed: 61 Access
Pack, 24 relay, 5 delivery-board, 285 extension, and 53 live-session tests. The
checked-in unpacked-extension build was regenerated.

## Blocker

No code blocker. Physical-device evidence remains unavailable to this environment:
real-browser keyboard, reload, Windows, and screen-reader observations must be
performed by an operator.

## Owner

Codex, at Anurup Kumar's direction (AL-010 on the Part 1 QA branch).

## Next action

An operator must load the unpacked extension in a real browser, use every control
with a keyboard, reload to confirm persistence, and include Windows/screen-reader
observations in the capture and rehearsal evidence rather than treating unit tests
as physical-device proof.
