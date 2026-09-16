---
id: AL-052
title: Fix inert and inverted high-contrast preference
status: IN_REVIEW
priority: P1
depends_on: []
task_ids: [A6]
threads: []
affected_paths: [apps/extension/src/style.css,apps/extension/src/style.test.ts]
contract_impact: none; CSS-only
data_impact: none
demo_impact: the accessibility feature named "Higher contrast" now actually raises contrast everywhere it exists, instead of lowering it or doing nothing
human_decision: none
---

## Outcome

Ran `axe-core` with `color-contrast` enabled (unit tests deliberately disable
that rule because jsdom cannot compute real layout/contrast) against the
built `dist/` in a real browser. Found two real bugs in the exact feature
whose purpose is raising contrast:

1. In dark mode, turning on "Higher contrast" on the Live lesson route
   produced **1.11:1** contrast (`#f2f2f2` text on a `#ffffff` background) --
   nearly invisible, the opposite of the feature's purpose.
2. The Review route's "Higher contrast" preference (shared state, set from
   Live lesson) had **zero effect** at all -- `.review-experience.high-contrast`
   had no matching CSS rule in the stylesheet.

Root cause for both: `color`/`background` are ordinary inherited CSS
properties, resolved once where declared (`:root`/`body`) and passed down as
already-computed pixel values -- not as live `var()` references that
re-resolve at every descendant. `.student-experience.high-contrast` only
overrode the `--ink`/`--paper` *custom properties*, never redeclared the
`color`/`background` *properties* themselves, so any descendant that relies
on inheritance (rather than its own `color: var(--ink)`) kept whatever
`:root` had already resolved to -- the dark-mode value.
`.review-experience.high-contrast` didn't exist as a rule at all.

## Scope

Combined the selector into `.student-experience.high-contrast,
.review-experience.high-contrast { ... color: var(--ink); background:
var(--paper); }` so both surfaces share one rule and both explicitly
re-anchor inheritance. Added `apps/extension/src/style.test.ts`, a static
regression guard asserting both selectors exist and both declare `color`/
`background`, not just the custom properties -- the class of bug a jsdom
component test structurally cannot catch, since jsdom neither loads real
stylesheets in these tests nor computes real cascade/contrast.

## Non-goals

No broader CSS audit beyond this specific preference; no change to the
default (non-high-contrast) palette, which was already fine.

## Acceptance criteria

With "Higher contrast" on, both the Live lesson and Review routes render
black text on a white background (verified: `rgb(0, 0, 0)` on `rgb(255, 255,
255)`), and `axe-core` reports zero `color-contrast` violations in a real
browser on both routes with the toggle on.

## Test plan

Verified live in the browser preview: loaded the rebuilt `dist/` via
`preview_start`, injected real `axe-core` via CDN (unit tests disable
`color-contrast` for jsdom), ran it on Live lesson and Review with "Higher
contrast" on -- zero violations, confirmed computed `color`/`background`
directly. Added `style.test.ts` and proved it can fail by reverting the fix
locally, confirming both assertions failed with the exact ~1.1:1-causing
shape, then restored it. Full `npm test` (344, +2 new), `npm run typecheck`,
`make check`.

## Failure behavior

N/A -- CSS fix.

## Handoff requirements

None outstanding. Real screen-reader/low-vision user testing of the
high-contrast mode is part of the existing device/accessibility QA already
tracked in `docs/DEMO_PROOF_SPRINT.md`, not a new separate requirement.
