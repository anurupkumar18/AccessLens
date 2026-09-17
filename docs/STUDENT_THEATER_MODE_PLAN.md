# Student "theater mode": plan (post-demo work)

Status: **planning only, not started**. Scoped and agreed via Q&A on
2026-09-17. Do not implement before the demo — this is deliberately deferred
so nothing destabilizes a working presentation.

## Problem

The student view today is a stack of independent sections you scroll
through: live video (if streaming), instructor captions, the mode tabs
(Focus/Read/Reading spacing/AR), study chat, screen-reader settings, and
display preferences, each its own block. It works, but it reads like a
settings page, not a live moment shared with an instructor. The ask is a
second, more immersive presentation of the same data — closer to a video
call than a landing page — without weakening what already works.

## Scope

- **A new, optional full-tab view** ("theater mode"), not a replacement.
  The existing compact side-panel experience stays exactly as it is today
  for anyone who wants the quick/simple path. This is additive.
- Entry point: an explicit "Expand to full view" / "Theater mode" action
  from the current student experience. Exact placement/wording is a UI
  decision for implementation time, not blocking this plan.
- Reference model: a video-call layout (Zoom/Meet) — one main stage,
  everything else as toggleable overlays/panels around it, not stacked
  sections requiring scroll.

## Layout decisions (from the Q&A pass)

1. **Focus / Read / Reading spacing / AR stay mutually exclusive.** One
   main-stage content mode at a time, same as today — the redesign changes
   the layout and chrome around the content, not this switching model.
2. **Captions become an always-visible overlay**, docked to the stage
   (like broadcast captions), independent of which content mode is active.
   No more separate "Instructor's words" section you scroll to find.
3. **Study chat becomes a toggleable side panel**, like a video call's chat
   drawer — slides in/out without resizing or leaving the main stage.
4. **Video and reviewed content share the stage** rather than stacking
   (live video above, content below, as today). Likely picture-in-picture
   or a split view; exact treatment is an implementation-time call, informed
   by which one keeps captions/AR legible at the same time.

## Non-negotiable constraint: accessibility

This was decided explicitly, not left implicit: **accessibility is the hard
constraint the visual redesign must fit inside, not a fast-follow.** AccessLens's
entire premise is that no student loses the lesson to their access need — a
video-call-style layout (floating overlays, picture-in-picture, drawers) is a
well-known regression risk for screen reader and keyboard users if built
without deliberate care. Concretely, before this ships:

- Every overlay/panel (captions dock, chat drawer, PiP video) needs a
  fully equivalent screen-reader and keyboard path — not just visually
  present, but reachable and operable without a pointer.
- Toggling a panel must not steal or lose focus unexpectedly, and must be
  announced (e.g. via `aria-live` or focus management), consistent with the
  existing keyboard-equivalent work already in the codebase
  (`docs/CONTEXT_RELAY.md`'s Review-route keyboard-format-navigation record
  is the existing bar to match).
- Run the existing axe-core coverage (episodic `0064-automated-accessibility-coverage.md`
  pattern) against the new view before it's considered done, not just the
  old one.
- If a visual idea and an accessibility requirement conflict, the
  accessibility requirement wins. This was an explicit decision, not a
  default assumption.

## What this plan does NOT cover (open for implementation time)

- Exact visual design (spacing, colors, iconography) — this doc scopes
  structure and constraints, not pixels.
- Whether video-and-content sharing the stage is PiP, split-pane, or
  something else — needs a prototype to judge legibility with captions
  and AR simultaneously visible.
- Keyboard shortcuts for toggling panels (chat, captions) — needs its own
  small design pass so shortcuts don't collide with existing ones
  (arrow-key AR rotation, mode-tab navigation).
- Whether "theater mode" preference persists per student (localStorage) or
  resets each session.

## Suggested phased approach (after the demo)

1. **Static layout pass**: build the new full-tab shell (stage + overlay
   slots) with placeholder/dummy content, validate the structure reads well
   and doesn't box in the accessibility requirements above before wiring
   real data.
2. **Wire one mode first** (Focus is the best-tested today) into the new
   shell, including its screen-reader path, before adding the rest.
3. **Add captions overlay**, then **chat drawer**, each with their own
   accessibility pass before moving to the next.
4. **Add video-sharing-the-stage** last — it's the most visually complex
   piece and the least urgent for a first version to prove the concept.
5. **Full regression QA**: the existing compact side-panel view must be
   provably untouched throughout — run the full extension test suite plus
   a manual pass of everything already proven working (live sync, captions,
   translate, study chat, AR) after each phase, not just at the end.

## Why this is scoped as "later," not "now"

The team explicitly chose to design this now but build it after the demo,
given the timeline risk of touching the student experience — the single
most tested and highest-value surface in the product — hours before
presenting. Nothing here blocks or changes what ships today.
