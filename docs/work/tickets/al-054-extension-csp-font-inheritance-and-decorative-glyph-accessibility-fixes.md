---
id: AL-054
title: Extension CSP, font inheritance, and decorative-glyph accessibility fixes
status: IN_REVIEW
priority: P2
depends_on: []
task_ids: [A6]
threads: []
affected_paths: [apps/extension/src/shared,apps/extension/src/main.tsx,apps/extension/src/style.css]
contract_impact: none
data_impact: none
demo_impact: no CSP violation noise on load; the extension's chosen font actually applies in a packed/unpacked install; decorative glyphs no longer risk a redundant screen-reader announcement
human_decision: none
---

## Outcome

While evaluating `ui/blacksmith-revamp`'s `94f0047` for cross-branch
integration, found its fixes tangled with that branch's own UI restyle
(different CSS variable names) and dyslexia-font content, so the commit
itself wasn't cherry-picked (see AL-053's handoff and RL-053). Three of its
underlying fixes were independently valuable and reimplemented directly
against this branch instead of cherry-picked:

1. **Zod CSP violation.** Zod probes for `eval` support via `new Function('')`
   when an object schema is first created. Manifest V3's default extension
   CSP forbids `eval`, so the probe fails harmlessly but reports a CSP
   violation on every load. `z.config({ jitless: true })`, imported first in
   `main.tsx`, disables the probe.
2. **Body font inheritance.** Chrome gives an installed extension page its
   own default `body` font (system-ui, 75% size), which can override
   `:root`'s chosen font (IBM Plex) on running text in the actual
   packed/unpacked extension -- not reproducible in this project's plain
   browser-tab `dist` preview, so verified by code inspection and Manifest
   V3's documented default extension stylesheet rather than a live repro.
   `body { font: inherit; }` fixes it defensively.
3. **Decorative glyph accessible names.** `.draft-note::before` and the three
   `.connection-pill` state glyphs prepend a Unicode symbol before real
   status text with no `aria-hidden` wrapper (unlike the already-hidden step
   checkmark), so a screen reader could announce the glyph literally before
   the meaningful word. Added the CSS Generated Content alt-text production
   (`content: '...' / ''`) to mark them decorative.

## Scope

New `apps/extension/src/shared/zodConfig.ts` + test, imported first in
`main.tsx`; three `style.css` rules given accessible-alt annotations and a
`body` font-inheritance fix.

## Non-goals

Did not merge `94f0047` itself, its dyslexia-font-specific CSS, or its
`webSocketSessionClient.ts`/relay reconnect changes -- those remain flagged
in RL-053 for a closer, separate look since they're either coupled to the
UI restyle or need review of `services/live-session` changes not yet
evaluated.

## Acceptance criteria

`z.config().jitless` is `true` after importing the extension entry point.
Verified in a real browser: no console errors on load, `axe-core` reports
zero violations with the glyph fix applied, and the built stylesheet still
renders the glyphs visibly (the alt-text production doesn't affect visual
rendering, only the accessibility tree).

## Test plan

New `zodConfig.test.ts` (1 test); full `npm test` (355), `npm run typecheck`,
`make check`; loaded the rebuilt `dist/` in the browser preview, confirmed no
console errors, zero axe violations, and screenshotted both the instructor
and student views to confirm glyphs still render.

## Failure behavior

N/A -- defensive/hardening fixes, no new failure path.

## Handoff requirements

None outstanding. The body-font fix's real effect is only observable in an
actual packed/unpacked extension install (`chrome-extension://` origin), not
this project's plain-browser-tab `dist` preview -- worth a quick visual check
during the next real unpacked-extension QA pass.
