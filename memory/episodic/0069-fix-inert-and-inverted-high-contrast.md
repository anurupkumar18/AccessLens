# Fix inert and inverted high-contrast preference

## Goal

Do real accessibility testing that the existing jsdom-based unit suite
structurally cannot do: run `axe-core` with `color-contrast` enabled against
the actual built extension in a real browser (the unit tests disable that
rule specifically because jsdom cannot compute real layout/contrast).

## What was found

Two bugs in the "Higher contrast" preference, the one feature whose entire
purpose is raising contrast:

1. **Live lesson, dark mode:** turning it on produced `#f2f2f2` text on a
   `#ffffff` background -- 1.11:1 contrast, nearly invisible, worse than
   having it off.
2. **Review route:** the preference (shared state, set from Live lesson) had
   zero effect -- `.review-experience.high-contrast` had no matching CSS
   rule at all in `style.css`.

Root cause, confirmed by inspecting live computed styles in the browser
rather than guessing from source: `color` and `background` are ordinary
*inherited* CSS properties. They get resolved once, wherever they're
declared (`:root`, `body`), into a fixed computed pixel value, and that
value is what descendants inherit -- not a live reference to the custom
property. `.student-experience.high-contrast` only overrode the `--ink`/
`--paper` *custom properties*; it never redeclared the `color`/`background`
*properties* on itself, so any descendant relying on inheritance (rather
than its own `color: var(--ink)`) kept whatever `:root` had already resolved
to before reaching that scope -- the dark-mode value, `#f2f2f2`.
`.review-experience.high-contrast` was simpler: the selector class was
applied by the React component, but the CSS rule for it never existed.

## Changed files

- `apps/extension/src/style.css`: combined both surfaces under one selector,
  `.student-experience.high-contrast, .review-experience.high-contrast`, and
  added explicit `color: var(--ink); background: var(--paper);` declarations
  alongside the custom-property overrides.
- `apps/extension/src/style.test.ts` (new): a static regression guard
  asserting both selectors exist in the stylesheet and both declare `color`/
  `background`, not just the custom properties. Proven able to fail: reverted
  the fix locally, confirmed both assertions failed with output matching the
  exact bug shape, then restored the fix.

## Validation evidence

Verified live: started the dist preview server, injected real `axe-core` via
CDN, toggled "Higher contrast" on both Live lesson and Review, confirmed zero
`color-contrast` violations and `getComputedStyle` showing `rgb(0,0,0)` on
`rgb(255,255,255)` on both. Full suite: 344 tests pass (2 new), `npm run
typecheck` clean, `make check` green end to end.

## Data and scope boundary

CSS-only change; no contract, event, or data-handling code touched.

## Blocker

None. Real low-vision/screen-reader user testing of high-contrast mode folds
into the existing `docs/DEMO_PROOF_SPRINT.md` device/accessibility matrix.

## Owner

Codex, at Anurup Kumar's direction (AL-052, found while executing the
session's `/goal` "final privacy, security, accessibility, and guardrail
testing" and "fix remaining accessibility bugs" items).

## Next action

General lesson for future preference-driven scoped-override CSS: a class
that overrides custom properties for a color scheme must also redeclare the
actual `color`/`background` properties on that same scope, or descendants
that rely on inheritance won't pick up the change. `style.test.ts` now
guards the two known instances of this pattern; a third surface introducing
the same pattern would need its own assertion added.
