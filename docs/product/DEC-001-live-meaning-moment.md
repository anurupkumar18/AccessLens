# DEC-001 — Live meaning moment

**Status:** Active product decision

## Decision

AccessLens is an extension-first, real-time live visual-meaning system. An
instructor explicitly shares approved content; local matching or a visible manual
correction emits a semantic event; students receive the same reviewed meaning in a
locally chosen Focus, Read, Hear, or Spatial route.

The product solves the gap between an instructor's visual referent and a student's
ability to access that referent in the live moment. It is not a diagnosis-driven
personalization system, a surveillance tool, a caption replacement, or a general
AI tutor.

## Consequences

- Student mode choice and any private catch-up state remain local.
- Raw screen, audio, and camera media remain off the live service by default.
- Unknown content is `source.unmatched`, never an invented description.
- AI supports explicit pre-class drafting only; a human must approve all student
  facing content before publication or live delivery.
- AR remains a required renderer with equivalent non-immersive, keyboard, and
  semantic routes. Do not claim the screen-rendered AR route independently serves
  a fully blind student; reviewed audio and structured text carry that meaning.

## Human decision boundary

Changing this direction, the data charter, the retention model, or the MVP scope
requires a recorded human decision. T-29 is the current meeting agenda for that
discussion; it does not invalidate the current decision meanwhile.
