# Review keyboard format navigation

## Goal

Make non-live Review format selection keyboard-equivalent to the live student
route, without recording a student’s keys or chosen mode.

## Changed files

- Added roving tab selection with ArrowLeft/ArrowRight/Home/End.
- Added tab IDs, selected tab focus transfer, and explicit tabpanel relations.
- Preserved pack-driven removal of an unavailable AR tab.

## Validation evidence

The focused Review component suite passed four tests, including keyboard mode
selection and ARIA relationships. Extension typecheck passed; the repository-wide
batch is intentionally deferred.

## Data and scope boundary

No keyboard input, mode preference, identity, or activity is persisted or sent.
The change only selects an existing local reviewed renderer.

## Blocker

Physical keyboard, screen-reader, narrow-panel, and AR/no-AR observations remain
QA work; this is not an accessibility audit result.

## Owner

Codex, at Anurup Kumar's direction (AL-044 accessibility hardening).

## Next action

Include this slice in the next full check batch and run the physical accessibility
matrix before asserting demo readiness.
