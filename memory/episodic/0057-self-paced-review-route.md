# Self-paced Review route

## Goal

Deliver the first independently testable Review-mode vertical slice using only the
reviewed Access Pack already checked into the extension.

## Changed files

- Added a Student Review surface, separate from the live lesson, with a clear
  non-live label, self-paced reviewed-concept navigation, and the existing
  Focus/Read/Hear/available-AR renderers.
- Added bounded local bookmark storage keyed to one reviewed pack; it is not part
  of live session state.
- Added an execution board covering owner, status, evidence, and next action for
  the whole project.

## Validation evidence

Focused Review/bookmark/App tests passed (8), followed by full `make check`: 61
Access Pack, 24 relay, 5 delivery-board, 293 extension, and 53 live-session tests.
The checked-in unpacked-extension build was regenerated.

## Blocker

No code blocker. An operator must verify extension navigation, bookmark reload,
keyboard behavior, AR fallback, and narrow side-panel layout. Instructor
publication, course integration, session-history retention, Canvas/RAG, models,
and reviewer evidence require separate approval and implementation.

## Owner

Codex, at Anurup Kumar's direction (AL-040 feature-branch prototype).

## Next action

QA this route in the unpacked extension, then either hand it off as a local-pack
prototype or authorize a separate publish/retention design. Do not describe it as
a class recording or a Canvas/RAG feature.
